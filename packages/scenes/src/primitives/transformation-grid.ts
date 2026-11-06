import type { Rect } from "../canvas";
import { formatNumber } from "../layout/format";
import { bounds, text } from "../layout/geometry";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import type { LineElement, Role, SceneElement, TextElement } from "../layout/types";
import { coordinateGrid, type CoordinateGrid, type GridOptions } from "./coordinate-grid";

/**
 * Transformation grid: a coordinate grid with square units, so moves can be counted in squares,
 * plus the column vector and the move arrows a translation needs.
 */

export function transformationGrid(options: Omit<GridOptions, "equal">): CoordinateGrid {
  return coordinateGrid({ ...options, equal: true });
}

export interface ColumnVector {
  elements: SceneElement[];
  top: TextElement;
  bottom: TextElement;
  box: Rect;
}

/**
 * A column vector: two numbers one above the other between tall round brackets, its top-left
 * corner at (x, y). The brackets are drawn as curves, so the numbers stay real text.
 */
export function columnVector(
  id: string,
  role: Role,
  upper: number,
  lower: number,
  x: number,
  y: number,
  size: number,
): ColumnVector {
  const bracket = size * 0.32;
  const gap = size * 0.2;
  const probeTop = text(`${id}.top`, role, formatNumber(upper), 0, 0, {
    size,
    align: "middle",
    valign: "top",
  });
  const probeBottom = text(`${id}.bottom`, role, formatNumber(lower), 0, 0, {
    size,
    align: "middle",
    valign: "top",
  });
  const column = Math.max(probeTop.w, probeBottom.w);
  const centre = x + bracket + gap + column / 2;
  const top = text(`${id}.top`, role, formatNumber(upper), centre, y + gap * 0.5, {
    size,
    align: "middle",
    valign: "top",
  });
  // A little space between the rows: the glyphs of the two numbers must not touch.
  const bottom = text(
    `${id}.bottom`,
    role,
    formatNumber(lower),
    centre,
    top.y + top.h + gap * 0.6,
    {
      size,
      align: "middle",
      valign: "top",
    },
  );
  const height = bottom.y + bottom.h + gap * 0.5 - y;
  const width = 2 * (bracket + gap) + column;
  // A round bracket: a shallow arc from top to bottom, bulging outwards.
  const arc = (left: boolean): number[] => {
    const edge = left ? x : x + width;
    const inner = left ? x + bracket : x + width - bracket;
    return Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      const bulge = Math.sin(Math.PI * t);
      return [inner + (edge - inner) * bulge, y + t * height];
    }).flat();
  };
  return {
    elements: [
      { id: `${id}.left`, role, type: "polygon", open: true, points: arc(true) },
      top,
      bottom,
      { id: `${id}.right`, role, type: "polygon", open: true, points: arc(false) },
    ],
    top,
    bottom,
    box: { x, y, width, height },
  };
}

/** An arrow for one move of a translation, from one grid point to another. */
export function moveArrow(
  id: string,
  role: Role,
  from: [number, number],
  to: [number, number],
): LineElement {
  return {
    id,
    role,
    type: "line",
    x1: from[0],
    y1: from[1],
    x2: to[0],
    y2: to[1],
    width: 5,
    arrow: true,
  };
}

/**
 * Text broken into the given lines (not wherever the width runs out), so a coordinate pair is
 * never split. Its top-left corner is at (x, y).
 */
export function textLines(
  id: string,
  role: Role,
  lines: readonly string[],
  x: number,
  y: number,
  size: number,
): TextElement {
  const width = Math.max(...lines.map((line) => measureText(line, size).w));
  return {
    id,
    role,
    type: "text",
    x,
    y,
    w: width,
    h: lines.length * LINE_HEIGHT * size,
    size,
    font: "body",
    align: "start",
    text: lines.join("\n"),
  };
}

/** A light highlighter wash behind a label ("look here"). */
export function wash(id: string, label: TextElement, pad: number): SceneElement {
  const box = bounds(label);
  return {
    id,
    role: "highlight",
    type: "rect",
    x: box.x - pad,
    y: box.y,
    w: box.width + 2 * pad,
    h: box.height,
    fill: true,
  };
}
