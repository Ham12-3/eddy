import { describe, expect, it } from "vitest";
import { AA_BODY_TEXT, contrastRatio, relativeLuminance } from "./contrast";
import { placeholderPalette } from "./placeholder-palette";

describe("contrastRatio", () => {
  it("matches the WCAG extremes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("does not depend on argument order", () => {
    expect(contrastRatio("#14213D", "#F6F3EA")).toBeCloseTo(
      contrastRatio("#F6F3EA", "#14213D"),
      10,
    );
  });

  it("rejects colours that are not #rrggbb", () => {
    expect(() => relativeLuminance("teal")).toThrow(/#rrggbb/);
  });

  it("confirms the accent text issue flagged in SPEC.md section 11", () => {
    expect(contrastRatio("#D9480F", "#F6F3EA")).toBeLessThan(AA_BODY_TEXT);
  });
});

describe("placeholder palette", () => {
  for (const [mode, colours] of Object.entries(placeholderPalette)) {
    it(`${mode}: ink and muted ink meet AA body text on paper and raised paper`, () => {
      for (const text of [colours.ink, colours.inkMuted]) {
        for (const background of [colours.paper, colours.paperRaised]) {
          expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(AA_BODY_TEXT);
        }
      }
    });
  }
});
