import { describe, expect, it } from "vitest";
import { SCENE_ASPECT_RATIOS, safeArea } from "./index";

describe("safeArea", () => {
  it("keeps a 6% margin on every side", () => {
    expect(safeArea(1600, 900)).toEqual({ x: 96, y: 54, width: 1408, height: 792 });
  });

  it("rejects empty canvases", () => {
    expect(() => safeArea(0, 900)).toThrow(/positive/);
  });
});

describe("SCENE_ASPECT_RATIOS", () => {
  it("uses 16:9 on desktop and 4:5 on mobile", () => {
    expect(SCENE_ASPECT_RATIOS.desktop).toEqual({ width: 16, height: 9 });
    expect(SCENE_ASPECT_RATIOS.mobile).toEqual({ width: 4, height: 5 });
  });
});
