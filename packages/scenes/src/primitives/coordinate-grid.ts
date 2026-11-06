import type { Rect } from "../canvas";
import { formatNumber } from "../layout/format";
import {
  bounds,
  contains,
  overlaps,
  grow,
  paragraph,
  text,
  type Anchor,
  type VerticalAnchor,
} from "../layout/geometry";
import { LINE_HEIGHT, measureMaths, measureText } from "../layout/measure";
import type { LineElement, MathNode, Role, SceneElement, TextElement } from "../layout/types";

/**
 * Coordinate grid: faint gridlines, x and y axes with arrowheads and names, and scale labels on
 * every n-th gridline, chosen so the labels never collide. Plus the pieces a graph needs: points,
 * straight lines through points, and labels placed beside their objects without touching anything.
 */

export interface GridOptions {
  id: string;
  region: Rect;
  /** Values each axis must show. The origin is always shown, with `pad` units of space around. */
  xs: readonly number[];
  ys: readonly number[];
  /** Label size in canvas units. */
  size: number;
  /** One unit is the same length on both axes, so squares can be counted. */
  equal?: boolean;
  /** Units of space beyond the outermost values; default 1. */
  pad?: number;
  /** Extra units on one side, for a label beside the outermost value there. */
  padLeft?: number;
  padRight?: number;
  padTop?: number;
  padBottom?: number;
}

export interface CoordinateGrid {
  /** Gridlines (background layer), the axes, their arrowheads and their names. */
  elements: SceneElement[];
  /**
   * Scale labels, in order of importance. Keep only those clear of the scene's own content with
   * `clearOf`, so a label never sits under a line or a point.
   */
  labels: TextElement[];
  px: (x: number) => number;
  py: (y: number) => number;
  /** The plotting area: the visible range of values. */
  plot: Rect;
  /** Units per gridline on each axis. */
  step: { x: number; y: number };
  /** The axes and their names: other labels keep clear of these. */
  obstacles: Rect[];
}

const STEPS = [1, 2, 5, 10, 20, 50];
/** Gridlines closer than this (canvas units) would turn into a grey wash on a phone. */
const MIN_GRID = 22;

function niceStep(unitLength: number, minLength: number, multipleOf: number): number {
  for (const step of STEPS) {
    if (step % multipleOf === 0 && step * unitLength >= minLength) return step;
  }
  return STEPS[STEPS.length - 1] as number;
}

interface Range {
  lo: number;
  hi: number;
}

function aligned(range: Range, step: number): Range {
  return { lo: Math.floor(range.lo / step) * step, hi: Math.ceil(range.hi / step) * step };
}

function widest(values: readonly number[], size: number): number {
  return Math.max(...values.map((value) => measureText(formatNumber(value), size).w));
}

export function coordinateGrid(options: GridOptions): CoordinateGrid {
  const { id, region, size } = options;
  const pad = options.pad ?? 1;
  const arrow = size * 0.5;
  const gap = size * 0.3;
  const labelH = LINE_HEIGHT * size;
  const xName = measureMaths([{ sym: "x" }], size);

  let xRange: Range = {
    lo: Math.min(0, ...options.xs) - pad - (options.padLeft ?? 0),
    hi: Math.max(0, ...options.xs) + pad + (options.padRight ?? 0),
  };
  let yRange: Range = {
    lo: Math.min(0, ...options.ys) - pad - (options.padBottom ?? 0),
    hi: Math.max(0, ...options.ys) + pad + (options.padTop ?? 0),
  };

  // The area left for plotting once the arrowheads and axis names have room.
  // Lines are 4 units thick: keep them a few units inside the region.
  const outer = {
    left: region.x + 4,
    top: region.y + arrow + labelH / 2 + 2,
    right: region.x + region.width - (arrow + gap + xName.w),
    bottom: region.y + region.height - 4,
  };

  const fit = (): Rect => {
    const spanX = xRange.hi - xRange.lo;
    const spanY = yRange.hi - yRange.lo;
    // Scale labels sit left of the y-axis and below the x-axis: leave room for them at the edges.
    const needLeft = widest([yRange.lo, yRange.hi], size) + gap;
    const needBottom = labelH + gap;
    // The axis sits a fraction f of the way across: move the edge in until its labels fit.
    const fx = -xRange.lo / spanX;
    const fy = -yRange.lo / spanY;
    const left = Math.max(outer.left, (outer.left + needLeft - fx * outer.right) / (1 - fx));
    const bottom = Math.min(outer.bottom, (outer.bottom - needBottom - fy * outer.top) / (1 - fy));
    if (!options.equal)
      return { x: left, y: outer.top, width: outer.right - left, height: bottom - outer.top };
    const unit = Math.min((outer.right - left) / spanX, (bottom - outer.top) / spanY);
    const [w, h] = [unit * spanX, unit * spanY];
    // Centre the grid in the space it has, without crowding the scale labels.
    const minX = outer.left + Math.max(0, needLeft - fx * w);
    const x = Math.min(
      Math.max(minX, outer.left + (outer.right - outer.left - w) / 2),
      outer.right - w,
    );
    const maxBottom = outer.bottom - Math.max(0, needBottom - fy * h);
    const y = Math.max(
      outer.top,
      Math.min(maxBottom, outer.top + (outer.bottom - outer.top + h) / 2) - h,
    );
    return { x, y, width: w, height: h };
  };

  let step = { x: 1, y: 1 };
  for (let pass = 0; pass < 2; pass += 1) {
    const trial = fit();
    if (!options.equal) {
      step = {
        x: niceStep(trial.width / (xRange.hi - xRange.lo), MIN_GRID, 1),
        y: niceStep(trial.height / (yRange.hi - yRange.lo), MIN_GRID, 1),
      };
    }
    xRange = aligned(xRange, step.x);
    yRange = aligned(yRange, step.y);
  }
  const plot = fit();

  const spanX = xRange.hi - xRange.lo;
  const spanY = yRange.hi - yRange.lo;
  const px = (value: number) => plot.x + ((value - xRange.lo) / spanX) * plot.width;
  const py = (value: number) => plot.y + plot.height - ((value - yRange.lo) / spanY) * plot.height;
  const [x0, y0] = [px(0), py(0)];
  const right = plot.x + plot.width;
  const bottom = plot.y + plot.height;

  const elements: SceneElement[] = [];
  for (let value = xRange.lo; value <= xRange.hi; value += step.x) {
    if (value === 0) continue;
    elements.push({
      id: `${id}.grid.v${value}`,
      role: "structure",
      layer: "background",
      type: "line",
      x1: px(value),
      y1: plot.y,
      x2: px(value),
      y2: bottom,
      width: 2,
    });
  }
  for (let value = yRange.lo; value <= yRange.hi; value += step.y) {
    if (value === 0) continue;
    elements.push({
      id: `${id}.grid.h${value}`,
      role: "structure",
      layer: "background",
      type: "line",
      x1: plot.x,
      y1: py(value),
      x2: right,
      y2: py(value),
      width: 2,
    });
  }

  // Axes run the full width and height, then on to an arrowhead at the positive end.
  const xAxis: LineElement = {
    id: `${id}.axis.x`,
    role: "structure",
    type: "line",
    x1: plot.x,
    y1: y0,
    x2: right + arrow * 0.5,
    y2: y0,
    width: 4,
  };
  const yAxis: LineElement = {
    id: `${id}.axis.y`,
    role: "structure",
    type: "line",
    x1: x0,
    y1: bottom,
    x2: x0,
    y2: plot.y - arrow * 0.5,
    width: 4,
  };
  const tipX = right + arrow;
  const tipY = plot.y - arrow;
  const heads: SceneElement[] = [
    {
      id: `${id}.axis.xHead`,
      role: "structure",
      type: "polygon",
      points: [tipX, y0, tipX - arrow, y0 - arrow * 0.6, tipX - arrow, y0 + arrow * 0.6],
      fill: true,
    },
    {
      id: `${id}.axis.yHead`,
      role: "structure",
      type: "polygon",
      points: [x0, tipY, x0 - arrow * 0.6, tipY + arrow, x0 + arrow * 0.6, tipY + arrow],
      fill: true,
    },
  ];
  elements.push(xAxis, yAxis, ...heads);
  const xNameLabel = text(`${id}.axis.xName`, "structure", [{ sym: "x" }], tipX + gap * 0.6, y0, {
    size,
    align: "start",
  });
  const yNameLabel = text(
    `${id}.axis.yName`,
    "structure",
    [{ sym: "y" }],
    x0 + arrow * 0.6 + gap,
    tipY,
    { size, align: "start" },
  );
  elements.push(xNameLabel, yNameLabel);

  // Scale labels on every n-th gridline: far enough apart that neighbours never touch.
  const xLabelW = widest([xRange.lo, xRange.hi], size);
  const everyX = niceStep(plot.width / spanX, xLabelW + gap, step.x);
  const everyY = niceStep(plot.height / spanY, labelH + gap * 0.5, step.y);
  const labels: TextElement[] = [];
  const within = region;
  for (let value = Math.ceil(xRange.lo / everyX) * everyX; value <= xRange.hi; value += everyX) {
    if (value === 0) continue;
    const label = text(
      `${id}.scale.x${value}`,
      "structure",
      formatNumber(value),
      px(value),
      y0 + gap,
      { size, valign: "top" },
    );
    if (contains(within, bounds(label))) labels.push(label);
  }
  for (let value = Math.ceil(yRange.lo / everyY) * everyY; value <= yRange.hi; value += everyY) {
    if (value === 0) continue;
    const label = text(
      `${id}.scale.y${value}`,
      "structure",
      formatNumber(value),
      x0 - gap,
      py(value),
      { size, align: "end" },
    );
    if (contains(within, bounds(label))) labels.push(label);
  }
  const origin = text(`${id}.scale.origin`, "structure", "0", x0 - gap, y0 + gap, {
    size,
    align: "end",
    valign: "top",
  });
  if (contains(within, bounds(origin))) labels.push(origin);

  return {
    elements,
    // Scale labels never sit on an arrowhead or an axis name.
    labels: clearOf(labels, [...heads, xNameLabel, yNameLabel].map(bounds)),
    px,
    py,
    plot,
    step,
    obstacles: [xAxis, yAxis, ...heads, xNameLabel, yNameLabel].map(bounds),
  };
}

/**
 * The labels that keep `margin` clear of every obstacle and clear of each other, in order: an
 * earlier label wins. Scale labels give way to the scene's own content this way.
 */
export function clearOf(
  labels: readonly TextElement[],
  obstacles: readonly Rect[],
  margin = 2,
): TextElement[] {
  const kept: TextElement[] = [];
  for (const label of labels) {
    const box = bounds(label);
    const clear = grow(box, margin);
    if (
      obstacles.some((other) => overlaps(clear, other)) ||
      kept.some((other) => overlaps(grow(box, 2), bounds(other)))
    )
      continue;
    kept.push(label);
  }
  return kept;
}

/** How far apart two boxes are (0 when they touch or overlap). */
export function distance(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/** Where a label may go: its anchor point and how it hangs from it. */
export interface Spot {
  x: number;
  y: number;
  align: Anchor;
  valign: VerticalAnchor;
}

export type Direction =
  "right" | "left" | "above" | "below" | "aboveRight" | "aboveLeft" | "belowRight" | "belowLeft";

/** Spots around a box in the order given, at each distance in turn (nearest first). */
export function spotsAround(
  box: Rect,
  gaps: readonly number[],
  order: readonly Direction[],
): Spot[] {
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  return gaps.flatMap((gap) => {
    const [left, right, top, bottom] = [
      box.x - gap,
      box.x + box.width + gap,
      box.y - gap,
      box.y + box.height + gap,
    ];
    const spots: Record<Direction, Spot> = {
      right: { x: right, y: cy, align: "start", valign: "middle" },
      left: { x: left, y: cy, align: "end", valign: "middle" },
      above: { x: cx, y: top, align: "middle", valign: "bottom" },
      below: { x: cx, y: bottom, align: "middle", valign: "top" },
      aboveRight: { x: right, y: top, align: "start", valign: "bottom" },
      aboveLeft: { x: left, y: top, align: "end", valign: "bottom" },
      belowRight: { x: right, y: bottom, align: "start", valign: "top" },
      belowLeft: { x: left, y: bottom, align: "end", valign: "top" },
    };
    return order.map((direction) => spots[direction]);
  });
}

/**
 * Spots along one side of a box, for a label beside a line: the middle first, then further
 * along each way, then lined up with either end, so a label can step aside from an axis or
 * another label. Each distance in `gaps` is tried in turn.
 */
export function spotsBeside(
  box: Rect,
  side: "above" | "below" | "left" | "right",
  gaps: readonly number[],
): Spot[] {
  return gaps.flatMap((gap) => {
    const spots: Spot[] = [0.5, 0.35, 0.65, 0.2, 0.8].map((f) =>
      side === "above" || side === "below"
        ? {
            x: box.x + f * box.width,
            y: side === "above" ? box.y - gap : box.y + box.height + gap,
            align: "middle",
            valign: side === "above" ? "bottom" : "top",
          }
        : {
            x: side === "left" ? box.x - gap : box.x + box.width + gap,
            y: box.y + f * box.height,
            align: side === "left" ? "end" : "start",
            valign: "middle",
          },
    );
    if (side === "above" || side === "below") {
      const y = side === "above" ? box.y - gap : box.y + box.height + gap;
      const valign = side === "above" ? "bottom" : "top";
      spots.push(
        { x: box.x + gap, y, align: "start", valign },
        { x: box.x + box.width - gap, y, align: "end", valign },
      );
    } else {
      const x = side === "left" ? box.x - gap : box.x + box.width + gap;
      const align = side === "left" ? "end" : "start";
      spots.push(
        { x, y: box.y + gap, align, valign: "top" },
        { x, y: box.y + box.height - gap, align, valign: "bottom" },
      );
    }
    return spots;
  });
}

export interface PlaceOptions {
  size: number;
  font?: "body" | "pen";
  within: Rect;
  avoid: readonly Rect[];
  /** Clear space kept around the label; default a tenth of the size. */
  margin?: number;
  /** One word to a line ("15" over "down"): a narrow label for beside a vertical line. */
  stacked?: boolean;
}

/** Whether a label sits inside `within` and clear of everything in `avoid`. */
export function labelFits(label: TextElement, options: PlaceOptions): boolean {
  const box = bounds(label);
  const margin = options.margin ?? options.size * 0.1;
  return (
    contains(options.within, box) &&
    !options.avoid.some((other) => overlaps(grow(box, margin), other))
  );
}

/**
 * A label at the first spot where it fits inside `within` and keeps clear of everything in
 * `avoid`. If no spot works it takes the first, and the static checks report the clash.
 */
export function placeLabel(
  id: string,
  role: Role,
  content: string | MathNode[],
  spots: readonly Spot[],
  options: PlaceOptions,
): TextElement {
  const margin = options.margin ?? options.size * 0.1;
  let first: TextElement | undefined;
  for (const spot of spots) {
    const style = {
      size: options.size,
      font: options.font,
      align: spot.align,
      valign: spot.valign,
    };
    const label =
      options.stacked && typeof content === "string"
        ? paragraph(id, role, content, spot.x, spot.y, 1, style)
        : text(id, role, content, spot.x, spot.y, style);
    first ??= label;
    const box = bounds(label);
    if (
      contains(options.within, box) &&
      !options.avoid.some((other) => overlaps(grow(box, margin), other))
    )
      return label;
  }
  if (!first) throw new Error(`No spots for ${id}`);
  return first;
}

/**
 * The line through two points, carried on `extend` canvas units beyond each and cut off at the
 * edge of `area` (Liang and Barsky's clipping).
 */
export function lineThrough(
  a: [number, number],
  b: [number, number],
  extend: number,
  area: Rect,
): [[number, number], [number, number]] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [ux, uy] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const start: [number, number] = [a[0] - ux * extend, a[1] - uy * extend];
  const [dx, dy] = [b[0] + ux * extend - start[0], b[1] + uy * extend - start[1]];
  let [t0, t1] = [0, 1];
  const edges: [number, number][] = [
    [-dx, start[0] - area.x],
    [dx, area.x + area.width - start[0]],
    [-dy, start[1] - area.y],
    [dy, area.y + area.height - start[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) continue;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return [
    [start[0] + dx * t0, start[1] + dy * t0],
    [start[0] + dx * t1, start[1] + dy * t1],
  ];
}

/** A plotted point: a filled dot. */
export function dot(id: string, role: Role, cx: number, cy: number, size: number): SceneElement {
  return { id, role, type: "circle", cx, cy, r: size * 0.24, fill: true };
}

/**
 * "(−2, 1)", with true minus signs. In running text pass `together` to join the pair with a
 * no-break space, so a line never breaks inside it.
 */
export function coordinates(x: number, y: number, together = false): string {
  return `(${formatNumber(x)},${together ? "\u00a0" : " "}${formatNumber(y)})`;
}
