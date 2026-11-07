import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TEMPLATES_BY_KEY, tierLContext } from "@eddy/scenes/registry";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler, MAX_BODY_BYTES, type RenderKeyframes } from "./serve";

const TOKEN = "test-token-0123456789-0123456789-abc";
const template = TEMPLATES_BY_KEY.get("number_line.compare_negatives")!;
const { item, studentAnswer } = template.sample;
const rendered: string[] = [];
const fakeKeyframes: RenderKeyframes = async (t, spec) => {
  rendered.push(`${t.key} ${spec.template}`);
  return { problems: [], images: [{ format: "desktop", width: 1152, beat: 0, png: "iVBORw0K" }] };
};

let server: Server;
let base = "";
beforeAll(async () => {
  const handler = createHandler({ token: TOKEN, keyframes: fakeKeyframes });
  server = createServer((request, response) => void handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function post(path: string, body: unknown, token = TOKEN) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-service-token": token },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("scene-check service", () => {
  it("answers health checks without a token", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("refuses a missing or wrong token", async () => {
    const body = { template: template.key, item, studentAnswer };
    expect((await post("/v1/scenes/context", body, "")).status).toBe(401);
    expect((await post("/v1/scenes/context", body, "x".repeat(TOKEN.length))).status).toBe(401);
  });

  it("refuses a short token at start-up", () => {
    expect(() => createHandler({ token: "short" })).toThrow(/at least 32/);
    expect(() => createHandler({ token: "shared-random-token" })).toThrow(/placeholder/);
  });

  it("gives the context Claude starts from", async () => {
    const { status, body } = await post("/v1/scenes/context", {
      template: template.key,
      item,
      studentAnswer,
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      template: "number_line.compare_negatives@1",
      focusIds: [...template.focusIds],
    });
    expect((body.claims as unknown[]).length).toBeGreaterThan(0);
  });

  it("checks a model's beats and returns the claims for maths-core", async () => {
    const beats = tierLContext(template, item, studentAnswer).tierD.beats;
    const ok = await post("/v1/scenes/check", {
      template: template.key,
      item,
      studentAnswer,
      beats,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.problems).toEqual([]);
    expect(ok.body.spec).toMatchObject({ misconception: template.misconception });
    expect((ok.body.labels as string[]).length).toBeGreaterThan(0);
    const bad = await post("/v1/scenes/check", {
      template: template.key,
      item,
      studentAnswer,
      beats: beats.slice(0, 2),
    });
    expect((bad.body.problems as string[]).join(" ")).toMatch(/Not shown/);
  });

  it("refuses unknown templates, bad parameters, deep and large bodies", async () => {
    expect(
      (await post("/v1/scenes/context", { template: "nope", item, studentAnswer })).status,
    ).toBe(404);
    const badItem = await post("/v1/scenes/context", {
      template: template.key,
      item: { first: "x" },
      studentAnswer,
    });
    expect(badItem.status).toBe(422);
    let deep: unknown = 1;
    for (let i = 0; i < 40; i += 1) deep = [deep];
    expect((await post("/v1/scenes/context", { template: template.key, item: deep })).status).toBe(
      400,
    );
    const large = await post("/v1/scenes/context", "x".repeat(MAX_BODY_BYTES + 10));
    expect(large.status).toBe(413);
    expect((await post("/v1/scenes/context", "not json")).status).toBe(400);
  });

  it("queues keyframe jobs", async () => {
    const spec = tierLContext(template, item, studentAnswer).tierD;
    const [a, b] = await Promise.all([
      post("/v1/scenes/keyframes", { template: template.key, spec }),
      post("/v1/scenes/keyframes", { template: template.key, spec }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(rendered).toHaveLength(2);
    expect(a.body.images).toHaveLength(1);
  });
});
