import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareNegatives } from "../templates/compare-negatives";
import { buildScene, type BuiltScene } from "../templates/template";
import { beatTimings, totalDuration } from "../timeline/timeline";
import { ScenePlayer } from "./ScenePlayer";

const scene: BuiltScene = buildScene(
  compareNegatives,
  compareNegatives.sample.item,
  compareNegatives.sample.studentAnswer,
);
const beats = scene.spec.beats.length;
const timings = beatTimings(scene.spec.beats.map((beat) => beat.narration));

function controls() {
  return screen.getByRole("group", { name: "Explanation controls" });
}

function step(): string {
  return controls().textContent?.match(/Step \d of \d/)?.[0] ?? "";
}

/** Runs the animation clock forward, a frame at a time. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScenePlayer", () => {
  it("opens paused on the first beat, never playing on its own", () => {
    render(<ScenePlayer scene={scene} />);
    expect(step()).toBe(`Step 1 of ${beats}`);
    advance(5000);
    expect(step()).toBe(`Step 1 of ${beats}`);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("steps forward one beat and stops there, and steps back", () => {
    render(<ScenePlayer scene={scene} />);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    advance(2000);
    expect(step()).toBe(`Step 2 of ${beats}`);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    advance(10_000);
    expect(step()).toBe(`Step 2 of ${beats}`); // it does not carry on
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(step()).toBe(`Step 1 of ${beats}`);
  });

  it("plays to the end and stops; play then starts again from the beginning", () => {
    render(<ScenePlayer scene={scene} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(totalDuration(timings) + 1000);
    expect(step()).toBe(`Step ${beats} of ${beats}`);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(100);
    expect(step()).toBe(`Step 1 of ${beats}`);
  });

  it("plays faster at 1.25x", () => {
    render(<ScenePlayer scene={scene} />);
    fireEvent.click(screen.getByRole("button", { name: "1.25x" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    // At 1x the second beat starts at timings[1].start; at 1.25x it is reached sooner.
    const startOfSecond = timings[1]!.start - timings[0]!.settled;
    advance(Math.ceil(startOfSecond / 1.25) + 100);
    expect(step()).toBe(`Step 2 of ${beats}`);
  });

  it("keeps the beat when reduced motion is switched on, and pauses", () => {
    const { rerender } = render(<ScenePlayer scene={scene} />);
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    advance(2000);
    rerender(<ScenePlayer scene={scene} reducedMotion />);
    expect(step()).toBe(`Step 2 of ${beats}`);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("answers the keyboard on the scene, and leaves browser shortcuts alone", () => {
    render(<ScenePlayer scene={scene} />);
    const stage = screen.getByRole("group", { name: /Step 1 of/ });
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    advance(2000);
    expect(step()).toBe(`Step 2 of ${beats}`);
    fireEvent.keyDown(stage, { key: "ArrowLeft" });
    expect(step()).toBe(`Step 1 of ${beats}`);
    fireEvent.keyDown(stage, { key: "r", ctrlKey: true });
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    fireEvent.keyDown(stage, { key: " " });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("keeps the step buttons focusable at either end", () => {
    render(<ScenePlayer scene={scene} />);
    const back = screen.getByRole("button", { name: "Previous step" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back).not.toBeDisabled();
  });

  it("shows the captions and, on request, the whole transcript", () => {
    render(<ScenePlayer scene={scene} />);
    expect(screen.getByText(scene.spec.beats[0]!.narration, { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    expect(screen.getByRole("region", { name: "Transcript" }).querySelectorAll("li")).toHaveLength(
      beats,
    );
  });
});
