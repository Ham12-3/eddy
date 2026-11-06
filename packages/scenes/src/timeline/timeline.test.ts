import { describe, expect, it } from "vitest";
import { bounds, turnedPoints } from "../layout/geometry";
import type { SceneLayout } from "../layout/types";
import {
  MIN_HOLD_MS,
  REDUCED_TRANSITION_MS,
  TRANSITION_MS,
  beatAt,
  beatTimings,
  endState,
  frameAt,
  totalDuration,
} from "./timeline";

const layout: SceneLayout = {
  format: "desktop",
  width: 1600,
  height: 900,
  frames: [
    { elements: [{ id: "a", role: "given", type: "rect", x: 0, y: 0, w: 100, h: 100 }] },
    {
      elements: [
        { id: "a", role: "given", type: "rect", x: 200, y: 0, w: 100, h: 100 },
        { id: "b", role: "student", type: "circle", cx: 50, cy: 50, r: 10 },
      ],
    },
  ],
};

describe("beat timings", () => {
  it("holds at least 1.2 s and longer for longer narration", () => {
    const [short, long] = beatTimings(["Hi.", "word ".repeat(20)]);
    expect(short!.settled - short!.start).toBe(TRANSITION_MS);
    expect(short!.end - short!.settled).toBe(MIN_HOLD_MS);
    expect(long!.end - long!.settled).toBeGreaterThan(6000);
    expect(long!.start).toBe(short!.end);
  });

  it("uses short cross-fades with reduced motion", () => {
    const [timing] = beatTimings(["Hi."], { reducedMotion: true });
    expect(timing!.settled - timing!.start).toBe(REDUCED_TRANSITION_MS);
  });

  it("finds the beat at a time, and keeps the last beat after the end", () => {
    const timings = beatTimings(["One.", "Two."]);
    expect(beatAt(timings, 0)).toBe(0);
    expect(beatAt(timings, timings[1]!.start + 1)).toBe(1);
    expect(beatAt(timings, totalDuration(timings) + 5000)).toBe(1);
  });
});

describe("frameAt", () => {
  const timings = beatTimings(["One.", "Two."]);

  it("fades the first beat in from nothing", () => {
    expect(frameAt(layout, timings, 0)).toEqual([]);
    const quarter = frameAt(layout, timings, TRANSITION_MS / 4)[0]!.opacity;
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(0.5);
    expect(frameAt(layout, timings, timings[0]!.settled)[0]!.opacity).toBe(1);
  });

  it("morphs a persisting element and fades a new one in", () => {
    const halfway = frameAt(layout, timings, timings[1]!.start + TRANSITION_MS / 2);
    const moving = halfway.find((item) => item.key === "a")!;
    expect(moving.element.type === "rect" && moving.element.x).toBeCloseTo(100);
    expect(moving.opacity).toBe(1);
    expect(halfway.find((item) => item.key === "b")!.opacity).toBeCloseTo(0.5);
  });

  it("cross-fades instead of moving with reduced motion", () => {
    const reduced = beatTimings(["One.", "Two."], { reducedMotion: true });
    const halfway = frameAt(layout, reduced, reduced[1]!.start + REDUCED_TRANSITION_MS / 2, {
      reducedMotion: true,
    });
    const positions = halfway
      .filter((item) => item.element.id === "a")
      .map((item) => item.element.type === "rect" && item.element.x);
    expect(positions.sort()).toEqual([0, 200]);
  });

  it("gives each beat's end state for the static diagram", () => {
    expect(endState(layout, 1).map((item) => item.key)).toEqual(["a", "b"]);
  });
});

describe("turns", () => {
  const piece = {
    id: "a",
    role: "correct" as const,
    type: "polygon" as const,
    points: [0, 0, 100, 0, 0, 100],
    fill: true,
  };
  const turning: SceneLayout = {
    format: "desktop",
    width: 1600,
    height: 900,
    frames: [
      { elements: [piece] },
      { elements: [{ ...piece, turn: { cx: 50, cy: 50, degrees: 180 } }] },
    ],
  };
  const timings = beatTimings(["One.", "Two."]);

  it("animates a half turn as a rotation, not corners sliding through the centre", () => {
    const halfway = frameAt(turning, timings, timings[1]!.start + TRANSITION_MS / 2)[0]!.element;
    expect(halfway.type === "polygon" && halfway.turn?.degrees).toBeCloseTo(90);
    expect(halfway.type === "polygon" && halfway.points).toEqual(piece.points);
  });

  it("measures a turned shape where it ends up", () => {
    const end = turning.frames[1]!.elements[0]!;
    expect(end.type === "polygon" && turnedPoints(end).map((v) => Math.round(v) + 0)).toEqual([
      100, 100, 0, 100, 100, 0,
    ]);
    expect(bounds(end).x).toBeCloseTo(-2);
  });
});
