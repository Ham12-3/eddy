import type { Rect } from "../canvas";
import type { LineElement, Role, SceneElement } from "../layout/types";

/**
 * Area model: a triangle drawn inside the rectangle around it, so the triangle can be seen to be
 * half of the rectangle. The perpendicular height runs from the apex to the base as a dashed line,
 * splitting the rectangle into two parts; in each part a sloping side cuts the part in half.
 */

export interface TriangleInRectangleOptions {
  /** Base and perpendicular height in centimetres. */
  base: number;
  height: number;
  /** Where the drawing may go: its bottom-left corner sits at the bottom left of the space. */
  space: Rect;
  /** How far along the base the apex sits, from 0 (left) to 1 (right). */
  apexAt?: number;
  /** Drawn height over drawn width is kept within these, so a very flat or tall triangle stays readable. */
  minRatio?: number;
  maxRatio?: number;
}

export interface TriangleInRectangle {
  /** Corners of the rectangle, and the apex and foot of the height. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  apex: [number, number];
  foot: [number, number];
  /** True when the drawing's proportions differ from the real ones. */
  notToScale: boolean;
}

/** Fits the triangle and its rectangle into the space, centred across it and sitting on its foot. */
export function triangleInRectangle(options: TriangleInRectangleOptions): TriangleInRectangle {
  const { base, height, space } = options;
  const ratio = height / base;
  const drawn = Math.min(Math.max(ratio, options.minRatio ?? 0.35), options.maxRatio ?? 1.5);
  const width = Math.min(space.width, space.height / drawn);
  const tall = width * drawn;
  const left = space.x + (space.width - width) / 2;
  const bottom = space.y + space.height;
  const top = bottom - tall;
  const apexX = left + width * (options.apexAt ?? 0.35);
  return {
    left,
    right: left + width,
    top,
    bottom,
    apex: [apexX, top],
    foot: [apexX, bottom],
    notToScale: Math.abs(drawn - ratio) > 1e-9,
  };
}

/** The triangle itself: base corners and apex. */
export function trianglePoints(shape: TriangleInRectangle): number[] {
  return [shape.left, shape.bottom, shape.right, shape.bottom, shape.apex[0], shape.apex[1]];
}

/**
 * The two pieces of the rectangle outside the triangle, left then right. Each is the matching
 * half of the triangle after a half turn about the middle of their shared sloping side.
 */
export function outsidePieces(shape: TriangleInRectangle): [number[], number[]] {
  return [
    [shape.left, shape.bottom, shape.left, shape.top, shape.apex[0], shape.apex[1]],
    [shape.apex[0], shape.apex[1], shape.right, shape.top, shape.right, shape.bottom],
  ];
}

/** The two halves of the triangle either side of its height, left then right. */
export function triangleHalves(shape: TriangleInRectangle): [number[], number[]] {
  return [
    [shape.left, shape.bottom, shape.foot[0], shape.foot[1], shape.apex[0], shape.apex[1]],
    [shape.apex[0], shape.apex[1], shape.foot[0], shape.foot[1], shape.right, shape.bottom],
  ];
}

/** The two parts of the rectangle either side of the height, left then right. */
export function rectangleParts(shape: TriangleInRectangle): [Rect, Rect] {
  const height = shape.bottom - shape.top;
  return [
    { x: shape.left, y: shape.top, width: shape.foot[0] - shape.left, height },
    { x: shape.foot[0], y: shape.top, width: shape.right - shape.foot[0], height },
  ];
}

/** A small square in the corner where the height meets the base, on its right. */
export function rightAngle(
  id: string,
  role: Role,
  shape: TriangleInRectangle,
  size: number,
): SceneElement {
  const [x, y] = shape.foot;
  const side = Math.min(size, (shape.right - x) * 0.4, (shape.bottom - shape.top) * 0.3);
  return {
    id,
    role,
    type: "polygon",
    open: true,
    points: [x + side, y, x + side, y - side, x, y - side],
  };
}

/**
 * A dimension line beside the shape: a vertical line from `top` to `bottom` at `x`, with a short
 * tick across each end. Ids `${id}.line`, `${id}.top`, `${id}.bottom`.
 */
export function dimension(
  id: string,
  role: Role,
  x: number,
  top: number,
  bottom: number,
  tick: number,
): LineElement[] {
  return [
    { id: `${id}.line`, role, type: "line", x1: x, y1: top, x2: x, y2: bottom, width: 3 },
    { id: `${id}.top`, role, type: "line", x1: x - tick, y1: top, x2: x + tick, y2: top, width: 3 },
    {
      id: `${id}.bottom`,
      role,
      type: "line",
      x1: x - tick,
      y1: bottom,
      x2: x + tick,
      y2: bottom,
      width: 3,
    },
  ];
}
