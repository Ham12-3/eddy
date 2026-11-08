import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Beat, JsonValue, SceneSpec } from "@eddy/schemas";
import {
  checkTierL,
  sceneFromSpec,
  TEMPLATES_BY_KEY,
  tierLContext,
  type ItemParams,
  type SceneFormat,
  type SceneTemplate,
} from "@eddy/scenes/registry";
import { checkKeyframes, describeKeyframeProblem } from "./keyframes";

/**
 * The scene engine's checks over HTTP, for services/api only (ADR-0030). The layout engine and the
 * static checks are TypeScript, and Tier L generation runs in Python, so the API asks here:
 *
 * - `POST /v1/scenes/context`: what Claude is told about a scene (Tier D spec, vocabulary, claims).
 * - `POST /v1/scenes/check`: assembles a spec from Claude's beats and runs every engine check.
 * - `POST /v1/scenes/keyframes`: draws every beat in headless Chromium, checks the DOM boxes and
 *   returns PNGs for the vision critique (background only, one job at a time).
 *
 * Private network plus a shared `X-Service-Token`, like maths-core. Bodies are capped in size and
 * depth, and the keyframe page runs with JavaScript and the network off.
 */

export const MAX_BODY_BYTES = 64 * 1024;
/** As maths-core: at least 32 characters, and never the placeholder from .env.example. */
export const MIN_TOKEN_LENGTH = 32;
const PLACEHOLDER_TOKENS = new Set(["shared-random-token"]);
export const MAX_DEPTH = 24;

/** The light keyframes the vision critique sees: a laptop and a phone. */
export const CRITIQUE_WIDTHS: Record<SceneFormat, number> = { desktop: 1152, mobile: 343 };

export interface KeyframeImage {
  format: SceneFormat;
  width: number;
  beat: number;
  /** Base64 PNG. */
  png: string;
}

export interface KeyframeReport {
  problems: string[];
  images: KeyframeImage[];
}

export type RenderKeyframes = (template: SceneTemplate, spec: SceneSpec) => Promise<KeyframeReport>;

/** Every beat at every width in both themes; PNGs kept only for the critique widths. */
export async function renderKeyframes(
  template: SceneTemplate,
  spec: SceneSpec,
): Promise<KeyframeReport> {
  const scene = sceneFromSpec(template, spec);
  const images: KeyframeImage[] = [];
  const problems = await checkKeyframes([scene], {
    capture: {
      wants: (frame) => frame.theme === "light" && frame.width === CRITIQUE_WIDTHS[frame.format],
      take: (frame, png) =>
        images.push({
          format: frame.format,
          width: frame.width,
          beat: frame.beat,
          png: png.toString("base64"),
        }),
    },
  });
  return { problems: problems.map(describeKeyframeProblem), images };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function depth(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(depth));
  if (value !== null && typeof value === "object") {
    return 1 + Math.max(0, ...Object.values(value).map(depth));
  }
  return 0;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, `Bodies are at most ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The body is not JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "The body must be a JSON object");
  }
  if (depth(body) > MAX_DEPTH) throw new HttpError(400, `JSON is at most ${MAX_DEPTH} levels deep`);
  return body as Record<string, unknown>;
}

function templateOf(body: Record<string, unknown>): SceneTemplate {
  const key = body.template;
  const template = typeof key === "string" ? TEMPLATES_BY_KEY.get(key) : undefined;
  if (!template) throw new HttpError(404, "Unknown scene template");
  return template;
}

function itemOf(body: Record<string, unknown>): ItemParams {
  const item = body.item;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new HttpError(400, "item must be an object of parameters");
  }
  return item as ItemParams;
}

function answerOf(body: Record<string, unknown>): JsonValue {
  if (!("studentAnswer" in body)) throw new HttpError(400, "studentAnswer is required");
  return body.studentAnswer as JsonValue;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

export interface HandlerOptions {
  token: string;
  keyframes?: RenderKeyframes;
}

export function createHandler(options: HandlerOptions) {
  if (options.token.length < MIN_TOKEN_LENGTH || PLACEHOLDER_TOKENS.has(options.token)) {
    throw new Error(
      `The service token must be at least ${MIN_TOKEN_LENGTH} characters, not a placeholder`,
    );
  }
  const expected = Buffer.from(options.token);
  const keyframes = options.keyframes ?? renderKeyframes;
  // One Chromium job at a time: they are background work, and each holds a browser.
  let queue: Promise<unknown> = Promise.resolve();

  async function route(request: IncomingMessage): Promise<unknown> {
    if (request.method === "GET" && request.url === "/health") return { status: "ok" };
    const given = Buffer.from(String(request.headers["x-service-token"] ?? ""));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError(401, "Missing or wrong service token");
    }
    if (request.method !== "POST") throw new HttpError(405, "Use POST");
    const body = await readJson(request);
    switch (request.url) {
      case "/v1/scenes/context":
        return tierLContext(templateOf(body), itemOf(body), answerOf(body));
      case "/v1/scenes/check": {
        const template = templateOf(body);
        const [item, studentAnswer] = [itemOf(body), answerOf(body)];
        if (!Array.isArray(body.beats)) throw new HttpError(400, "beats must be a list");
        const context = tierLContext(template, item, studentAnswer);
        const check = checkTierL(template, item, studentAnswer, body.beats as Beat[]);
        return { ...check, claims: context.claims, predicted: context.predicted };
      }
      case "/v1/scenes/keyframes": {
        const template = templateOf(body);
        const job = queue.then(() => keyframes(template, body.spec as SceneSpec));
        queue = job.catch(() => undefined);
        return await job;
      }
      default:
        throw new HttpError(404, "Not found");
    }
  }

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      send(response, 200, await route(request));
    } catch (error) {
      if (error instanceof HttpError) {
        send(response, error.status, { detail: error.message });
      } else {
        // A template refusing its parameters, or a spec the engine cannot build.
        send(response, 422, { detail: (error as Error).message.slice(0, 500) });
      }
    }
  };
}
