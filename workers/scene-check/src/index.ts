/**
 * The scene-check worker (M5) renders the end state of every beat headless. This works out which
 * frames those are; the Playwright renderer and SQS consumer arrive in M5.
 */

/** Frame index of the last frame of each beat, given beat durations in milliseconds. */
export function beatEndFrames(beatDurationsMs: readonly number[], fps: number): number[] {
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error("fps must be a positive integer");
  }
  const frames: number[] = [];
  let elapsedMs = 0;
  for (const duration of beatDurationsMs) {
    if (duration <= 0) {
      throw new Error("Beat durations must be positive");
    }
    elapsedMs += duration;
    frames.push(Math.max(0, Math.round((elapsedMs / 1000) * fps) - 1));
  }
  return frames;
}
