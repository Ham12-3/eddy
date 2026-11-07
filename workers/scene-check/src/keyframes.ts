import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CANVAS, type BuiltScene, type SceneFormat } from "@eddy/scenes/registry";
import { chromium, type Page } from "playwright";
import { compareText, type DomProblem, type DrawnText } from "./compare";
import { keyframeHtml, type Theme } from "./html";

/**
 * The keyframe checker (SPEC.md section 7.2, step 8): draws the end state of every beat in both
 * aspect ratios and both themes in headless Chromium, confirms the DOM text boxes match the
 * layout, and saves a screenshot of each. In production it runs off the hot path (M6); here it
 * runs over the default scenes in CI and on demand.
 */

/** Stage widths per format: the narrowest supported, a phone, a tablet and a laptop. */
export const STAGE_WIDTHS: Record<SceneFormat, number[]> = {
  mobile: [288, 343],
  desktop: [640, 704, 1152],
};
export const THEMES: Theme[] = ["light", "dark"];

export interface KeyframeProblem extends DomProblem {
  scene: string;
  format: SceneFormat;
  theme: Theme;
  width: number;
  beat: number;
}

export interface KeyframeOptions {
  /** Where screenshots go; none are saved when left out. */
  screenshots?: string;
  formats?: SceneFormat[];
  themes?: Theme[];
  /** Stage widths per format; STAGE_WIDTHS when left out. */
  widths?: Partial<Record<SceneFormat, number[]>>;
  /** Receives a PNG of each keyframe it accepts (the vision critique uses some of them). */
  capture?: Capture;
}

export interface Keyframe {
  scene: string;
  format: SceneFormat;
  theme: Theme;
  width: number;
  beat: number;
}

/** Says which keyframes it wants, and takes their PNGs. */
export interface Capture {
  wants(frame: Keyframe): boolean;
  take(frame: Keyframe, png: Buffer): void;
}

// Plain script text: the TypeScript runner adds helpers to named functions that a page lacks.
const MEASURE = `(() => {
  const canvas = document.querySelector(".eddy-scene-canvas");
  if (!canvas) throw new Error("No scene canvas on the page");
  const outer = canvas.getBoundingClientRect();
  // Positions are percentages of the area inside the border.
  const origin = { x: outer.x + canvas.clientLeft, y: outer.y + canvas.clientTop, width: canvas.clientWidth, height: canvas.clientHeight };
  const relative = (rect) => ({ x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height });
  const texts = Array.from(document.querySelectorAll(".eddy-scene-text")).map((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.querySelector(".katex-html") || element);
    return { id: element.dataset.elementId || "", box: relative(element.getBoundingClientRect()), ink: relative(range.getBoundingClientRect()) };
  });
  return { canvas: { width: origin.width, height: origin.height }, texts };
})()`;

// Waits for fonts, then reports any that failed and whether the scene font is in use.
const FONTS = `document.fonts.ready.then(() => {
  const faces = Array.from(document.fonts);
  return {
    failed: faces.filter((face) => face.status === "error").map((face) => face.family),
    body: faces.some((face) => face.family.includes("Atkinson") && face.status === "loaded"),
  };
})`;

async function measure(
  page: Page,
): Promise<{ canvas: { width: number; height: number }; texts: DrawnText[] }> {
  return (await page.evaluate(MEASURE)) as {
    canvas: { width: number; height: number };
    texts: DrawnText[];
  };
}

export async function checkKeyframes(
  scenes: readonly BuiltScene[],
  options: KeyframeOptions = {},
): Promise<KeyframeProblem[]> {
  const problems: KeyframeProblem[] = [];
  // JavaScript off and every request aborted: the page is inlined, so it needs nothing else, and
  // a hostile spec (Tier L, M6) could not make the checker fetch a file or an address.
  // Chromium's own sandbox on where the host allows it (the container in M10 sets this; CI
  // runners and some desktops lack the kernel features it needs).
  const browser = await chromium.launch({
    chromiumSandbox: process.env.SCENE_CHECK_CHROMIUM_SANDBOX === "1",
  });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1, javaScriptEnabled: false });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    for (const scene of scenes) {
      for (const format of options.formats ?? (["desktop", "mobile"] as SceneFormat[])) {
        const layout = scene.layouts[format];
        for (const theme of options.themes ?? THEMES) {
          for (const width of options.widths?.[format] ?? STAGE_WIDTHS[format]) {
            await page.setViewportSize({ width: width + 16, height: 1200 });
            for (let beat = 0; beat < layout.frames.length; beat += 1) {
              await page.setContent(keyframeHtml(scene, format, beat, theme, width));
              const fonts = (await page.evaluate(FONTS)) as { failed: string[]; body: boolean };
              if (fonts.failed.length > 0 || !fonts.body) {
                problems.push({
                  ids: [],
                  message: fonts.failed.length
                    ? `fonts failed to load: ${fonts.failed.join(", ")}`
                    : "the scene font did not load, so text was measured in a fallback",
                  scene: scene.template.key,
                  format,
                  theme,
                  width,
                  beat,
                });
              }
              const { canvas, texts } = await measure(page);
              const scale = canvas.width / CANVAS[format].width;
              const expected = (layout.frames[beat]?.elements ?? [])
                .filter((element) => element.type === "text")
                .map((element) => ({
                  id: element.id,
                  box: {
                    x: element.x * scale,
                    y: element.y * scale,
                    width: element.w * scale,
                    height: element.h * scale,
                  },
                }));
              for (const problem of compareText(expected, texts, canvas)) {
                problems.push({
                  ...problem,
                  scene: scene.template.key,
                  format,
                  theme,
                  width,
                  beat,
                });
              }
              const frame = { scene: scene.template.key, format, theme, width, beat };
              const wanted = options.capture?.wants(frame) ?? false;
              if (options.screenshots || wanted) {
                let path: string | undefined;
                if (options.screenshots) {
                  const directory = join(options.screenshots, scene.template.key);
                  mkdirSync(directory, { recursive: true });
                  path = join(directory, `${format}-${theme}-${width}-beat${beat + 1}.png`);
                }
                const png = await page.locator(".eddy-scene-canvas").screenshot({ path });
                if (wanted) options.capture?.take(frame, png);
              }
            }
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  return problems;
}

export function describeKeyframeProblem(problem: KeyframeProblem): string {
  return `${problem.scene} ${problem.format} ${problem.theme} ${problem.width}px beat ${problem.beat + 1}: ${problem.ids.join(", ")} ${problem.message}`;
}
