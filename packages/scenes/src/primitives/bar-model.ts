import type { Rect } from "../canvas";
import { text } from "../layout/geometry";
import { measureMaths, measureText } from "../layout/measure";
import type { MathNode, Role, SceneElement, TextElement } from "../layout/types";

/**
 * Bar model: a bar of equal parts, labels inside parts, and braces that label a run of parts
 * (the whole bar, or a group of parts) from above or below. Several bars with the same part
 * width line up part for part, so a comparison model is two bars drawn one under the other.
 */

export interface BarOptions {
  id: string;
  /** Left edge and top of the bar. */
  x: number;
  y: number;
  parts: number;
  partWidth: number;
  height: number;
  role: Role;
  /** A light wash of the role colour inside the parts. */
  fill?: boolean;
}

export interface Bar {
  id: string;
  elements: SceneElement[];
  partId: (index: number) => string;
  part: (index: number) => Rect;
  /** Parts from `from` up to, but not including, `to`. */
  span: (from: number, to: number) => Rect;
  box: Rect;
}

export function bar(options: BarOptions): Bar {
  const { id, x, y, parts, partWidth, height, role } = options;
  if (parts < 1 || !Number.isInteger(parts)) throw new Error("A bar needs a whole number of parts");
  const partId = (index: number) => `${id}.part.${index}`;
  const span = (from: number, to: number): Rect => ({
    x: x + from * partWidth,
    y,
    width: (to - from) * partWidth,
    height,
  });
  const part = (index: number) => span(index, index + 1);
  const elements: SceneElement[] = Array.from({ length: parts }, (_, index) => {
    const box = part(index);
    return {
      id: partId(index),
      role,
      type: "rect" as const,
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
      ...(options.fill ? { fill: true } : {}),
    };
  });
  return { id, elements, partId, part, span, box: span(0, parts) };
}

function measure(content: string | MathNode[], size: number): { w: number; h: number } {
  return typeof content === "string" ? measureText(content, size) : measureMaths(content, size);
}

/** Room left beside and above a label inside a part, as a multiple of the label size. */
const INSIDE_PAD = { x: 0.25, y: 0.05 };

/** Whether `rows` labels this size, stacked, fit inside one part of the bar. */
export function fitsInPart(
  target: Bar,
  contents: readonly (string | MathNode[])[],
  size: number,
  rows = 1,
): boolean {
  const part = target.part(0);
  return contents.every((content) => {
    const box = measure(content, size);
    return (
      box.w + 2 * size * INSIDE_PAD.x <= part.width &&
      rows * box.h + 2 * size * INSIDE_PAD.y <= part.height
    );
  });
}

/** A label centred inside a part; with `rows`, it sits in row `row` of that many. */
export function partLabel(
  target: Bar,
  index: number,
  id: string,
  role: Role,
  content: string | MathNode[],
  size: number,
  row = 0,
  rows = 1,
): TextElement {
  const part = target.part(index);
  const cy = part.y + (part.height * (row + 0.5)) / rows;
  return text(id, role, content, part.x + part.width / 2, cy, {
    size,
    inside: target.partId(index),
  });
}

export interface BraceOptions {
  id: string;
  role: Role;
  /** The run of parts the brace covers (from `Bar.span`). */
  span: Rect;
  side: "above" | "below";
  label: string | MathNode[];
  size: number;
  /** The label slides sideways to stay inside this box (a wide label over a narrow run). */
  within: Rect;
}

export interface Brace {
  elements: SceneElement[];
  label: TextElement;
  /** The brace and its label together: other labels keep clear of it. */
  box: Rect;
}

/** How far a brace sits from the bar, and its depth to its centre point, per unit of label size. */
const BRACE_GAP = 0.2;
const BRACE_DEPTH = 0.35;
const BRACE_POINT = 0.3;
/** Space between a brace's point and its label: room for a pen ring round the label. */
const LABEL_GAP = 0.4;

/** Total height a brace and its one-line label take beside a bar. */
export function braceHeight(size: number, content: string | MathNode[] = "0"): number {
  return size * (BRACE_GAP + BRACE_DEPTH + BRACE_POINT + LABEL_GAP) + measure(content, size).h;
}

/**
 * A square brace with a point in the middle, along one side of a run of parts, and its label
 * beyond the point. Ends are inset a little so braces over neighbouring runs do not touch.
 */
export function brace(options: BraceOptions): Brace {
  const { id, role, span, side, size, within } = options;
  const direction = side === "above" ? -1 : 1;
  const inset = Math.min(size * 0.15, span.width * 0.1);
  const [left, right] = [span.x + inset, span.x + span.width - inset];
  const mid = span.x + span.width / 2;
  const edge = side === "above" ? span.y : span.y + span.height;
  const near = edge + direction * size * BRACE_GAP;
  const line = near + direction * size * BRACE_DEPTH;
  const point = Math.min(size * BRACE_POINT, (right - left) / 4);
  const tip = line + direction * size * BRACE_POINT;
  const shape: SceneElement = {
    id: `${id}.brace`,
    role,
    type: "polygon",
    open: true,
    points: [
      left,
      near,
      left,
      line,
      mid - point,
      line,
      mid,
      tip,
      mid + point,
      line,
      right,
      line,
      right,
      near,
    ],
  };
  const labelEdge = tip + direction * size * LABEL_GAP;
  let label = text(`${id}.label`, role, options.label, mid, labelEdge, {
    size,
    valign: side === "above" ? "bottom" : "top",
  });
  // Slide a wide label sideways so it stays inside `within`.
  const shift = Math.max(
    within.x - label.x,
    Math.min(0, within.x + within.width - (label.x + label.w)),
  );
  if (shift !== 0) label = { ...label, x: label.x + shift };
  const top = Math.min(near, tip, label.y);
  const bottom = Math.max(near, tip, label.y + label.h);
  const x0 = Math.min(left, label.x);
  const x1 = Math.max(right, label.x + label.w);
  return {
    elements: [shape, label],
    label,
    box: { x: x0, y: top, width: x1 - x0, height: bottom - top },
  };
}
