import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SceneCanvas } from "@eddy/scenes/render";
import { endState, type BuiltScene, type SceneFormat } from "@eddy/scenes/registry";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * A self-contained page showing one beat's end state, as a student's browser would draw it: the
 * real tokens, fonts, KaTeX styles and scene styles, all inlined (fonts as data URIs), so the
 * checker loads nothing from disk or the network while the page is open.
 */

export type Theme = "light" | "dark";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const STYLESHEETS = [
  "packages/ui/src/styles/tokens.css",
  "packages/scenes/node_modules/@fontsource-variable/atkinson-hyperlegible-next/index.css",
  "packages/scenes/node_modules/@fontsource-variable/caveat/index.css",
  "packages/scenes/node_modules/katex/dist/katex.min.css",
  "packages/scenes/src/styles.css",
];

const FONT_URL = /url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g;

let inlined: string | undefined;

/** The stylesheets with every WOFF2 font replaced by a data URI. Built once per process. */
export function inlineStyles(): string {
  if (inlined === undefined) {
    inlined = STYLESHEETS.map((path) => {
      const file = resolve(ROOT, path);
      return readFileSync(file, "utf8").replace(FONT_URL, (_, url: string) => {
        const font = readFileSync(resolve(dirname(file), url)).toString("base64");
        return `url("data:font/woff2;base64,${font}")`;
      });
    }).join("\n");
  }
  return inlined;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);

export function keyframeHtml(
  scene: BuiltScene,
  format: SceneFormat,
  beat: number,
  theme: Theme,
  stageWidth: number,
): string {
  const layout = scene.layouts[format];
  const markup = renderToStaticMarkup(
    <SceneCanvas layout={layout} drawn={endState(layout, beat)} />,
  );
  const title = escape(`${scene.template.key} beat ${beat + 1}`);
  return `<!doctype html><html lang="en-GB" data-theme="${theme}"><head><meta charset="utf-8"><title>${title}</title><style>${inlineStyles()}</style><style>body{margin:0;padding:8px;background:var(--paper);color:var(--ink)}#stage{width:${stageWidth}px}</style></head><body><div id="stage">${markup}</div></body></html>`;
}
