import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareNegatives } from "../templates/compare-negatives";
import { buildScene, type BuiltScene } from "../templates/template";
import { beatTimings, totalDuration } from "../timeline/timeline";
import { ScenePlayer } from "./ScenePlayer";
import { speakable, type NarrationVoice } from "./voice";

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

/** A voice that speaks only when told to finish. */
function fakeVoice() {
  const spoken: { text: string; rate: number; done: () => void }[] = [];
  const voice: NarrationVoice & { stops: number } = {
    stops: 0,
    speak(text, rate, done) {
      spoken.push({ text, rate, done });
    },
    stop() {
      voice.stops += 1;
    },
  };
  return { voice, spoken };
}

describe("the device voice", () => {
  it("says there is no voice when the device has none", () => {
    render(<ScenePlayer scene={scene} voice={null} />);
    expect(screen.getByRole("button", { name: "No voice" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("speaks nothing until play, then holds each beat until its line is spoken", () => {
    const { voice, spoken } = fakeVoice();
    render(<ScenePlayer scene={scene} voice={voice} />);
    advance(3000);
    expect(spoken).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(100);
    expect(spoken.map((s) => s.text)).toEqual([speakable(scene.spec.beats[0]!.narration)]);
    // Well past the first beat's own length, it waits for the voice.
    advance(timings[1]!.end + 5000);
    expect(step()).toBe(`Step 1 of ${beats}`);
    act(() => spoken[0]!.done());
    advance(timings[1]!.settled - timings[0]!.end + 200);
    expect(step()).toBe(`Step 2 of ${beats}`);
    expect(spoken[1]!.text).toBe(speakable(scene.spec.beats[1]!.narration));
  });

  it("follows the speed, and stops when paused or switched off", () => {
    const { voice, spoken } = fakeVoice();
    render(<ScenePlayer scene={scene} voice={voice} />);
    fireEvent.click(screen.getByRole("button", { name: "1.25x" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(100);
    expect(spoken[0]!.rate).toBe(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(voice.stops).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Voice" }));
    expect(screen.getByRole("button", { name: "Voice" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(totalDuration(timings) + 1000);
    expect(spoken).toHaveLength(1);
    expect(step()).toBe(`Step ${beats} of ${beats}`);
  });

  it("finishes the last line after a pause instead of restarting the scene", () => {
    const { voice, spoken } = fakeVoice();
    render(<ScenePlayer scene={scene} voice={voice} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let i = 0; i < beats; i += 1) {
      advance(20_000);
      if (i < beats - 1) act(() => spoken[i]!.done());
    }
    expect(step()).toBe(`Step ${beats} of ${beats}`);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(100);
    expect(step()).toBe(`Step ${beats} of ${beats}`);
    expect(spoken.at(-1)!.text).toBe(speakable(scene.spec.beats[beats - 1]!.narration));
  });

  it("speaks again when played after the end", () => {
    const { voice, spoken } = fakeVoice();
    render(<ScenePlayer scene={scene} voice={voice} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let i = 0; i < beats; i += 1) {
      advance(20_000);
      act(() => spoken.at(-1)!.done());
    }
    advance(20_000);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    const before = spoken.length;
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    advance(100);
    expect(spoken.length).toBe(before + 1);
    expect(spoken.at(-1)!.text).toBe(speakable(scene.spec.beats[0]!.narration));
  });
});
