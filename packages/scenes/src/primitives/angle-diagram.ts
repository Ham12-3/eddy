import type { Rect } from "../canvas";
import {
  bounds,
  contains,
  grow,
  overlaps,
  slantedLine,
  text,
  toward,
  type Point,
} from "../layout/geometry";
import type { ArcElement, MathNode, Role, SceneElement, TextElement } from "../layout/types";

/**
 * Angle diagram: two parallel lines with their arrow marks, crossed by a slanted line, plus angle
 * arcs with labels inside them. Angles are in degrees, anticlockwise on screen from the positive
 * x direction, as `arc` elements take them.
 */

export function angleArc(
  id: string,
  role: Role,
  vertex: Point,
  from: number,
  to: number,
  r: number,
): ArcElement {
  return { id, role, type: "arc", cx: vertex.x, cy: vertex.y, r, from, to };
}

export interface AngleLabelOptions {
  size: number;
  /** Where the search starts, from the vertex along the bisector. */
  start: number;
  within: Rect;
  avoid: readonly Rect[];
  gap?: number;
}

/** How far a box is from a point: zero when the point is inside it. */
function distanceTo(box: Rect, point: Point): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/**
 * A label inside an angle, as close to the vertex as it can sit without touching anything in
 * `avoid` (each grown by `gap`) and inside `within`. Candidates lie on rays through the angle,
 * the bisector first, so the label always reads as belonging to that angle.
 */
export function angleLabel(
  id: string,
  role: Role,
  content: string | MathNode[],
  vertex: Point,
  from: number,
  to: number,
  options: AngleLabelOptions,
): TextElement {
  const gap = options.gap ?? options.size * 0.2;
  const avoid = options.avoid.map((box) => grow(box, gap));
  const base = text(id, role, content, 0, 0, { size: options.size });
  const at = (centre: Point): TextElement => ({
    ...base,
    x: base.x + centre.x,
    y: base.y + centre.y,
  });
  const half = (to - from) / 2;
  let best: { label: TextElement; score: number } | undefined;
  for (const share of [0, -0.25, 0.25, -0.5, 0.5, -0.7, 0.7]) {
    const ray = from + half + share * half;
    for (let distance = options.start; distance < options.start + 500; distance += 4) {
      const label = at(toward(vertex, ray, distance));
      const box = bounds(label);
      if (!contains(options.within, box) || avoid.some((other) => overlaps(box, other))) continue;
      // Closest to the vertex wins; leaving the bisector costs a little.
      const score = distanceTo(box, vertex) + Math.abs(share) * options.size * 0.6;
      if (!best || score < best.score) best = { label, score };
      break;
    }
  }
  // Nothing fitted: return the bisector choice, and let the static checks report it.
  return best?.label ?? at(toward(vertex, from + half, options.start));
}

export interface ParallelLinesOptions {
  id: string;
  region: Rect;
  /** The crossing line's direction going up, in degrees from the positive x direction (0 to 180). */
  slope: number;
  size: number;
  /** Which side of the crossing line each arrow mark sits on; the longer stretch by default. */
  marks?: { top: "left" | "right"; bottom: "left" | "right" };
}

export interface ParallelLines {
  /** Both parallel lines, their arrow marks and the crossing line. */
  elements: SceneElement[];
  /** Where the crossing line meets the top and the bottom parallel line. */
  top: Point;
  bottom: Point;
  slope: number;
  /** The direction from `top` down the crossing line towards `bottom`. */
  down: number;
  /** Where the parallel lines start and end. */
  left: number;
  right: number;
}

/**
 * Two horizontal parallel lines crossed by a slanted line, centred in the region. Each parallel
 * line carries the usual arrow mark, on the side away from the crossing line.
 */
export function parallelLines(options: ParallelLinesOptions): ParallelLines {
  const { id, region, slope, size } = options;
  const radians = (slope * Math.PI) / 180;
  // A shallow crossing line runs a long way across: keep that run within half the width.
  const gap = Math.min(
    region.height * 0.58,
    region.width * 0.5,
    region.width * 0.5 * Math.abs(Math.tan(radians)),
  );
  const above = (region.height - gap) / 2;
  const yTop = region.y + above;
  const yBottom = yTop + gap;
  // Horizontal distance from the bottom crossing to the top one (negative when it leans left).
  const run = gap / Math.tan(radians);
  const centre = region.x + region.width / 2;
  const top = { x: centre + run / 2, y: yTop };
  const bottom = { x: centre - run / 2, y: yBottom };
  const [left, right] = [region.x + 4, region.x + region.width - 4];
  // The crossing line runs on past each parallel line, staying inside the region.
  const across = Math.abs(Math.cos(radians));
  const room = Math.min(right - Math.max(top.x, bottom.x), Math.min(top.x, bottom.x) - left) - 4;
  const beyond = Math.min(
    (above * 0.75) / Math.sin(radians),
    across > 0.01 ? room / across : Infinity,
  );
  const start = toward(bottom, slope + 180, beyond);
  const end = toward(top, slope, beyond);

  const elements: SceneElement[] = [
    { id: `${id}.top`, role: "given", type: "line", x1: left, y1: yTop, x2: right, y2: yTop },
    {
      id: `${id}.bottom`,
      role: "given",
      type: "line",
      x1: left,
      y1: yBottom,
      x2: right,
      y2: yBottom,
    },
    ...slantedLine(`${id}.cross`, "given", start, end),
  ];
  // Arrow marks halfway along a stretch of each line, clear of the crossing line.
  const arrow = size * 0.3;
  const longer =
    right - Math.max(top.x, bottom.x) > Math.min(top.x, bottom.x) - left ? "right" : "left";
  for (const [name, at, side] of [
    ["topArrow", top, options.marks?.top ?? longer],
    ["bottomArrow", bottom, options.marks?.bottom ?? longer],
  ] as const) {
    const markX = side === "left" ? (left + at.x) / 2 : (at.x + right) / 2;
    elements.push({
      id: `${id}.${name}`,
      role: "given",
      type: "polygon",
      open: true,
      points: [markX - arrow, at.y - arrow, markX + arrow * 0.2, at.y, markX - arrow, at.y + arrow],
    });
  }
  return { elements, top, bottom, slope, down: slope + 180, left, right };
}
