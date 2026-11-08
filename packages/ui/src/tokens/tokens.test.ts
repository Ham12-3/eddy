// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, deltaE76 } from "../contrast";
import { DECORATIVE_TOKENS, contrastPairs } from "./contrast-pairs";
import { renderTokensCss } from "./render-css";
import { COLOUR_TOKENS, MODES, colours, dyslexiaLightPaper, type ColourToken } from "./tokens";

const palettes: Record<string, Record<ColourToken, string>> = {
  light: colours.light,
  dark: colours.dark,
  "dyslexia (cream)": { ...colours.light, ...dyslexiaLightPaper },
};

describe("contrast of every pair the design system uses", () => {
  for (const [modeName, palette] of Object.entries(palettes)) {
    for (const pair of contrastPairs) {
      it(`${modeName}: ${pair.use} meets ${pair.minimum}:1`, () => {
        const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
        expect(
          ratio,
          `${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(pair.minimum);
      });
    }
  }

  it("covers every colour token, apart from decorative ones", () => {
    const covered = new Set(contrastPairs.flatMap((pair) => [pair.foreground, pair.background]));
    const missing = COLOUR_TOKENS.filter(
      (token) => !covered.has(token) && !DECORATIVE_TOKENS.includes(token),
    );
    expect(missing).toEqual([]);
  });
});

describe("token values", () => {
  it("defines every colour in every mode as #rrggbb", () => {
    for (const mode of MODES) {
      for (const token of COLOUR_TOKENS) {
        expect(colours[mode][token]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("keeps the main-action accent clearly apart from the misconception red (ADR-0019)", () => {
    // CIELAB distance; the brief's dark pair (#FF7A3D, #FF7A66) was only 20.6 apart.
    for (const mode of MODES) {
      expect(deltaE76(colours[mode].accent, colours[mode].misconception)).toBeGreaterThanOrEqual(
        30,
      );
    }
  });
});

describe("generated CSS", () => {
  const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

  it("matches the token source (run `pnpm --filter @eddy/ui tokens:generate`)", () => {
    expect(css).toBe(renderTokensCss());
  });

  it("maps every colour token into the Tailwind theme", () => {
    const theme = readFileSync(new URL("../styles/index.css", import.meta.url), "utf8");
    for (const token of COLOUR_TOKENS) {
      expect(theme).toContain(`--color-${token}: var(--${token});`);
    }
  });
});
