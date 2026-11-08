import { narrationWords } from "@eddy/schemas";
import { lerp } from "../layout/geometry";
import type { SceneElement, SceneFrame, SceneLayout } from "../layout/types";

/**
 * A scene is a pure function of time (ADR-0027). Each beat starts with a transition from the
 * previous beat's end state, then holds long enough to read its narration (SPEC.md section 8.4:
 * transitions of 500 to 900 ms, holds of at least 1.2 s). With reduced motion every transition is
 * a 150 ms cross-fade and nothing moves.
 */

export const TRANSITION_MS = 700;
export const REDUCED_TRANSITION_MS = 150;
export const MIN_HOLD_MS = 1200;
/** About 180 words a minute, a comfortable pace for reading captions at 13. */
export const MS_PER_WORD = 330;
const READING_START_MS = 400;

export interface BeatTiming {
  start: number;
  /** When the transition into this beat's end state finishes. */
  settled: number;
  end: number;
}

export interface TimelineOptions {
  reducedMotion?: boolean;
  /** Extra hold per beat, in ms: thinking time after a prediction question. */
  pauses?: readonly number[];
}

/** Thinking time after an ask_prediction beat, before the scene moves on. */
export const PREDICTION_PAUSE_MS = 2500;

/** The extra hold each beat gets: thinking time after a prediction question. */
export function beatPauses(kinds: readonly string[]): number[] {
  return kinds.map((kind) => (kind === "ask_prediction" ? PREDICTION_PAUSE_MS : 0));
}

export function beatTimings(
  narrations: readonly string[],
  options: TimelineOptions = {},
): BeatTiming[] {
  const transition = options.reducedMotion ? REDUCED_TRANSITION_MS : TRANSITION_MS;
  const timings: BeatTiming[] = [];
  let start = 0;
  for (const [index, narration] of narrations.entries()) {
    const reading = READING_START_MS + narrationWords(narration) * MS_PER_WORD;
    const hold = Math.max(MIN_HOLD_MS, reading) + (options.pauses?.[index] ?? 0);
    timings.push({ start, settled: start + transition, end: start + transition + hold });
    start += transition + hold;
  }
  return timings;
}

export function totalDuration(timings: readonly BeatTiming[]): number {
  return timings.at(-1)?.end ?? 0;
}

/** The beat playing at time t. Times past the end belong to the last beat. */
export function beatAt(timings: readonly BeatTiming[], t: number): number {
  const index = timings.findIndex((timing) => t < timing.end);
  return index === -1 ? Math.max(0, timings.length - 1) : index;
}

/** One element as drawn at a moment: its interpolated geometry and its opacity. */
export interface Drawn {
  key: string;
  element: SceneElement;
  opacity: number;
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const GEOMETRY: Record<SceneElement["type"], string[]> = {
  line: ["x1", "y1", "x2", "y2"],
  rect: ["x", "y", "w", "h"],
  circle: ["cx", "cy", "r"],
  arc: ["cx", "cy", "r", "from", "to"],
  text: ["x", "y", "w", "h"],
  mark: ["x", "y", "w", "h"],
  polygon: [],
};

function numeric(element: SceneElement, field: string): number {
  return (element as unknown as Record<string, number>)[field] ?? 0;
}

/** Whether `a` can morph into `b`: same kind of thing, same colour, same words. */
export function canMorph(a: SceneElement, b: SceneElement): boolean {
  if (a.type !== b.type || a.role !== b.role) return false;
  if (a.type === "polygon" && b.type === "polygon") return a.points.length === b.points.length;
  if (a.type === "text" && b.type === "text") {
    return (
      a.text === b.text &&
      JSON.stringify(a.maths) === JSON.stringify(b.maths) &&
      a.size === b.size &&
      a.font === b.font
    );
  }
  if (a.type === "mark" && b.type === "mark") return a.kind === b.kind;
  return true;
}

/** Whether `a` and `b` differ in position or shape (the element moves during the transition). */
export function moves(a: SceneElement, b: SceneElement): boolean {
  if (a.type === "polygon" && b.type === "polygon") {
    return (
      a.points.some((value, i) => Math.abs(value - (b.points[i] ?? value)) > 0.5) ||
      Math.abs((a.turn?.degrees ?? 0) - (b.turn?.degrees ?? 0)) > 0.5
    );
  }
  return GEOMETRY[a.type].some((field) => Math.abs(numeric(a, field) - numeric(b, field)) > 0.5);
}

function interpolate(a: SceneElement, b: SceneElement, t: number): SceneElement {
  if (a.type === "polygon" && b.type === "polygon") {
    const points = b.points.map((value, i) => lerp(a.points[i] ?? value, value, t));
    if (!a.turn && !b.turn) return { ...b, points };
    // A turn animates its angle about the end state's centre: a rigid rotation.
    const centre = b.turn ?? a.turn ?? { cx: 0, cy: 0, degrees: 0 };
    const degrees = lerp(a.turn?.degrees ?? 0, b.turn?.degrees ?? 0, t);
    return { ...b, points, turn: { cx: centre.cx, cy: centre.cy, degrees } };
  }
  const result: Record<string, unknown> = { ...b };
  for (const field of GEOMETRY[b.type]) {
    result[field] = lerp(numeric(a, field), numeric(b, field), t);
  }
  return result as unknown as SceneElement;
}

const EMPTY: SceneFrame = { elements: [] };

/** Every element as drawn at time t. */
export function frameAt(
  layout: SceneLayout,
  timings: readonly BeatTiming[],
  t: number,
  options: TimelineOptions = {},
): Drawn[] {
  const index = beatAt(timings, t);
  const timing = timings[index];
  const current = layout.frames[index] ?? EMPTY;
  const previous = index > 0 ? (layout.frames[index - 1] ?? EMPTY) : EMPTY;
  if (!timing) return current.elements.map((element) => ({ key: element.id, element, opacity: 1 }));
  const span = timing.settled - timing.start;
  const raw = span > 0 ? Math.min(1, Math.max(0, (t - timing.start) / span)) : 1;
  const progress = options.reducedMotion ? raw : easeInOut(raw);

  const before = new Map(previous.elements.map((element) => [element.id, element]));
  const now = new Set(current.elements.map((element) => element.id));
  const drawn: Drawn[] = [];
  for (const element of current.elements) {
    const old = before.get(element.id);
    if (!old) {
      drawn.push({ key: element.id, element, opacity: progress });
    } else if (!moves(old, element) && canMorph(old, element)) {
      drawn.push({ key: element.id, element, opacity: 1 });
    } else if (!options.reducedMotion && canMorph(old, element)) {
      drawn.push({ key: element.id, element: interpolate(old, element, progress), opacity: 1 });
    } else {
      // Reduced motion, or a change that cannot morph: cross-fade in place.
      drawn.push({ key: `${element.id}:before`, element: old, opacity: 1 - progress });
      drawn.push({ key: element.id, element, opacity: progress });
    }
  }
  for (const element of previous.elements) {
    if (!now.has(element.id)) {
      drawn.push({ key: `${element.id}:leaving`, element, opacity: 1 - progress });
    }
  }
  return drawn.filter((item) => item.opacity > 0.001);
}

/** A beat's end state, for the static diagram and the keyframe checker. */
export function endState(layout: SceneLayout, beat: number): Drawn[] {
  return (layout.frames[beat] ?? EMPTY).elements.map((element) => ({
    key: element.id,
    element,
    opacity: 1,
  }));
}
