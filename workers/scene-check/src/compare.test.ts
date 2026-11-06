import { describe, expect, it } from "vitest";
import { compareText } from "./compare";

const canvas = { width: 800, height: 450 };
const box = { x: 100, y: 100, width: 200, height: 40 };

describe("compareText", () => {
  it("passes text drawn where the layout put it", () => {
    const ink = { x: 102, y: 106, width: 150, height: 28 };
    expect(compareText([{ id: "a", box }], [{ id: "a", box, ink }], canvas)).toEqual([]);
  });

  it("reports text drawn away from its box, spilling out, missing, or not in the layout", () => {
    const moved = { ...box, x: 110 };
    const spill = { x: 102, y: 106, width: 260, height: 28 };
    const problems = compareText(
      [
        { id: "a", box },
        { id: "b", box: { ...box, y: 300 } },
        { id: "c", box },
      ],
      [
        { id: "a", box: moved, ink: { ...spill, width: 100, x: 112 } },
        { id: "b", box: { ...box, y: 300 }, ink: { ...spill, y: 306 } },
        { id: "d", box: { ...box, y: 380 }, ink: { x: 102, y: 386, width: 50, height: 28 } },
      ],
      canvas,
    );
    expect(problems.map((p) => [p.ids.join(), p.message.replace(/[\d.]+/g, "N")])).toEqual([
      ["a", "is drawn N px away from its layout box"],
      ["b", "its text (N x N px) spills out of its box (N x N px)"],
      ["c", "is in the layout but not on the page"],
      ["d", "is on the page but not in the layout"],
    ]);
  });

  it("reports drawn text that overlaps, or runs off the canvas", () => {
    const ink = { x: 102, y: 106, width: 150, height: 28 };
    const off = { x: 700, y: 100, width: 200, height: 40 };
    const problems = compareText(
      [
        { id: "a", box },
        { id: "b", box },
        { id: "c", box: off },
      ],
      [
        { id: "a", box, ink },
        { id: "b", box, ink },
        { id: "c", box: off, ink: { ...off, x: 702, width: 150 } },
      ],
      canvas,
    );
    expect(problems.map((p) => p.message)).toEqual([
      "its text goes past the edge of the canvas",
      "drawn text overlaps",
    ]);
  });
});
