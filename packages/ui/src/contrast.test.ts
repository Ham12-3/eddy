import { describe, expect, it } from "vitest";
import { contrastRatio, deltaE76, relativeLuminance } from "./contrast";

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

  it("reproduces the brief's failing accent text (SPEC.md section 11)", () => {
    expect(contrastRatio("#D9480F", "#F6F3EA")).toBeLessThan(4.5);
  });
});

describe("deltaE76", () => {
  it("is zero for identical colours and large for black against white", () => {
    expect(deltaE76("#336699", "#336699")).toBe(0);
    expect(deltaE76("#000000", "#FFFFFF")).toBeCloseTo(100, 0);
  });

  it("flags the brief's dark accent and misconception red as too close", () => {
    expect(deltaE76("#FF7A3D", "#FF7A66")).toBeLessThan(25);
  });
});
