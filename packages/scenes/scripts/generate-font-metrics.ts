// Writes src/layout/font-metrics.json from the self-hosted font files, so text is measured the same
// way in Node and in the browser (SPEC.md section 8.3). Run: pnpm --filter @eddy/scenes fonts:generate
//
// Each font's default instance is weight 400, the only weight scenes use. fontkit cannot make other
// instances of a variable WOFF2 font, so emphasis in scenes comes from colour, marks and labels.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";

const FONTS = {
  body: "node_modules/@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2",
  pen: "node_modules/@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2",
  mathMain: "node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2",
  mathItalic: "node_modules/katex/dist/fonts/KaTeX_Math-Italic.woff2",
} as const;

// Printable ASCII plus the maths and currency symbols scenes use.
const EXTRA = [
  0xa3, 0xb0, 0xb2, 0xb3, 0xb7, 0xbd, 0xd7, 0xf7, 0x3c0, 0x2212, 0x2248, 0x2260, 0x2264, 0x2265,
  0x221a,
];
const CODE_POINTS = [...Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i), ...EXTRA];

const root = fileURLToPath(new URL("../", import.meta.url));
const metrics: Record<string, unknown> = {};
for (const [name, file] of Object.entries(FONTS)) {
  const font = fontkit.openSync(root + file) as fontkit.Font;
  const advances: Record<string, number> = {};
  for (const codePoint of CODE_POINTS) {
    if (font.hasGlyphForCodePoint(codePoint)) {
      advances[String.fromCodePoint(codePoint)] = font.glyphForCodePoint(codePoint).advanceWidth;
    }
  }
  metrics[name] = {
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    advances,
  };
}

const target = fileURLToPath(new URL("../src/layout/font-metrics.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(metrics, null, 1)}\n`, { encoding: "utf8" });
console.log("Wrote src/layout/font-metrics.json");
