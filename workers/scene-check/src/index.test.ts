import { describe, expect, it } from "vitest";
import { beatEndFrames } from "./index";

describe("beatEndFrames", () => {
  it("returns the last frame of each beat", () => {
    expect(beatEndFrames([2000, 1500, 1000], 30)).toEqual([59, 104, 134]);
  });

  it("rejects a non-positive frame rate or beat", () => {
    expect(() => beatEndFrames([1000], 0)).toThrow(/fps/);
    expect(() => beatEndFrames([0], 30)).toThrow(/positive/);
  });
});
