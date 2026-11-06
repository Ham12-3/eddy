import type { SceneFormat } from "../canvas";

/**
 * What the layout engine produces: for each beat, the end state of every element on the canvas,
 * in canvas units. The renderer interpolates between consecutive frames; the static checks and
 * the keyframe checker read the same data. Nothing here is chosen by a model.
 */

/**
 * Colour comes only from the role (SPEC.md section 8.1). `structure` is axes, ticks, outlines
 * and grids (ink-muted, or the faint rule colour on the background layer).
 */
export const ROLES = [
  "given",
  "student",
  "misconception",
  "correct",
  "highlight",
  "structure",
] as const;
export type Role = (typeof ROLES)[number];

/** Maths in a label, measured with KaTeX's fonts and rendered by KaTeX with MathML. */
export type MathNode =
  | { num: string }
  | { sym: string }
  | { op: string }
  | { text: string }
  | { frac: [MathNode[], MathNode[]] }
  | { pow: [MathNode[], MathNode[]] }
  | { sqrt: MathNode[] };

interface Base {
  /** Declared by the template; beats focus on these ids. Same id in two frames: it persists. */
  id: string;
  role: Role;
  /** Background elements (rules, grids) may sit under other elements. */
  layer?: "background";
}

export interface LineElement extends Base {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
  dash?: boolean;
  arrow?: boolean;
}

export interface RectElement extends Base {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  /** A light wash of the role colour inside the outline. */
  fill?: boolean;
}

export interface PolygonElement extends Base {
  type: "polygon";
  /** x0, y0, x1, y1, ... */
  points: number[];
  fill?: boolean;
  /** An open polyline rather than a closed shape. */
  open?: boolean;
  /**
   * A rigid turn of the whole shape about (cx, cy), in degrees anticlockwise on screen. The
   * timeline animates the angle, so a half turn is drawn as a rotation, never as corners sliding
   * through the centre.
   */
  turn?: { cx: number; cy: number; degrees: number };
}

export interface CircleElement extends Base {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  fill?: boolean;
}

/** An angle marker. Angles in degrees, anticlockwise on screen from the positive x direction. */
export interface ArcElement extends Base {
  type: "arc";
  cx: number;
  cy: number;
  r: number;
  from: number;
  to: number;
}

export interface TextElement extends Base {
  type: "text";
  /** The measured box the text sits in. */
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  font: "body" | "pen";
  text?: string;
  maths?: MathNode[];
  align: "start" | "middle" | "end";
  /** A shape this label may sit inside without counting as an overlap. */
  inside?: string;
}

/** Teacher's-pen marks: colour is never the only signal for a faulty step. */
export interface MarkElement extends Base {
  type: "mark";
  kind: "strike" | "cross" | "tick" | "underline" | "ring";
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SceneElement =
  | LineElement
  | RectElement
  | PolygonElement
  | CircleElement
  | ArcElement
  | TextElement
  | MarkElement;

export interface SceneFrame {
  elements: SceneElement[];
}

export interface SceneLayout {
  format: SceneFormat;
  width: number;
  height: number;
  /** One frame per beat: the end state of that beat. */
  frames: SceneFrame[];
}
