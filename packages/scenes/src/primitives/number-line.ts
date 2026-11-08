import type { Rect } from "../canvas";
import { formatNumber } from "../layout/format";
import { bounds, overlaps, text } from "../layout/geometry";
import { measureText } from "../layout/measure";
import type { Role, SceneElement } from "../layout/types";

/**
 * Number line: an axis with ticks, labels every few ticks and arrowheads at both ends, plus
 * points placed on it. Numbers grow to the right.
 */

export interface NumberLineOptions {
  id: string;
  region: Rect;
  min: number;
  max: number;
  /** Distance between ticks, in number-line units. */
  tick: number;
  /** Label every n-th tick; zero is always labelled. */
  labelEvery: number;
  size: number;
  /** Height of the axis inside the region, from 0 (top) to 1 (bottom). */
  at?: number;
}

export interface NumberLine {
  elements: SceneElement[];
  /** Canvas x for a value. */
  x: (value: number) => number;
  y: number;
  tickHeight: number;
  /** The axis with its tick labels: other labels keep clear of it. */
  box: Rect;
}

export function numberLine(options: NumberLineOptions): NumberLine {
  const { id, region, min, max, tick, size } = options;
  const arrow = size * 0.5;
  // The end ticks sit far enough in that their labels, and the arrowheads, stay in the region.
  const endLabel =
    Math.max(measureText(formatNumber(min), size).w, measureText(formatNumber(max), size).w) / 2;
  const inset = Math.max(arrow * 1.6, endLabel + 2);
  const left = region.x + inset;
  const right = region.x + region.width - inset;
  const [tipLeft, tipRight] = [region.x + 3, region.x + region.width - 3];
  const y = region.y + region.height * (options.at ?? 0.5);
  const x = (value: number) => left + ((value - min) / (max - min)) * (right - left);
  const tickHeight = size * 0.45;
  const elements: SceneElement[] = [
    {
      id: `${id}.axis`,
      role: "structure",
      type: "line",
      x1: tipLeft + arrow * 0.5,
      y1: y,
      x2: tipRight - arrow * 0.5,
      y2: y,
      width: 4,
    },
    {
      id: `${id}.arrowLeft`,
      role: "structure",
      type: "polygon",
      points: [tipLeft, y, tipLeft + arrow, y - arrow * 0.6, tipLeft + arrow, y + arrow * 0.6],
      fill: true,
    },
    {
      id: `${id}.arrowRight`,
      role: "structure",
      type: "polygon",
      points: [tipRight, y, tipRight - arrow, y - arrow * 0.6, tipRight - arrow, y + arrow * 0.6],
      fill: true,
    },
  ];
  const count = Math.round((max - min) / tick);
  let labelBottom = y + tickHeight;
  for (let i = 0; i <= count; i += 1) {
    const value = min + i * tick;
    const labelled = i % options.labelEvery === 0 || Math.abs(value) < 1e-9;
    const half = labelled ? tickHeight : tickHeight * 0.6;
    elements.push({
      id: `${id}.tick.${i}`,
      role: "structure",
      type: "line",
      x1: x(value),
      y1: y - half,
      x2: x(value),
      y2: y + half,
      width: 3,
    });
    if (labelled) {
      const label = text(
        `${id}.label.${i}`,
        "structure",
        formatNumber(value),
        x(value),
        y + tickHeight + size * 0.2,
        {
          size,
          valign: "top",
        },
      );
      labelBottom = Math.max(labelBottom, label.y + label.h);
      elements.push(label);
    }
  }
  return {
    elements,
    x,
    y,
    tickHeight,
    box: {
      x: region.x,
      y: y - tickHeight,
      width: region.width,
      height: labelBottom - (y - tickHeight),
    },
  };
}

/** A point on the line with its label above it. */
export function pointOn(
  line: NumberLine,
  id: string,
  value: number,
  role: Role,
  size: number,
  label = formatNumber(value),
): SceneElement[] {
  const cx = line.x(value);
  const r = size * 0.28;
  return [
    { id: `${id}.dot`, role, type: "circle", cx, cy: line.y, r, fill: true },
    text(`${id}.label`, role, label, cx, line.y - line.tickHeight - size * 0.25, {
      size,
      valign: "bottom",
    }),
  ];
}

export interface LinePoint {
  id: string;
  value: number;
  role: Role;
  label?: string;
}

/**
 * Several points with their labels above the line. A label that would touch an earlier one is
 * lifted a row higher, so close values (such as -3 and -2) stay readable.
 */
export function pointsOn(
  line: NumberLine,
  points: readonly LinePoint[],
  size: number,
): SceneElement[] {
  const elements: SceneElement[] = [];
  const placed: SceneElement[] = [];
  for (const point of points) {
    const [dot, label] = pointOn(line, point.id, point.value, point.role, size, point.label) as [
      SceneElement,
      SceneElement,
    ];
    let lifted = label;
    for (
      let row = 1;
      placed.some((other) => overlaps(bounds(other), bounds(lifted), 1));
      row += 1
    ) {
      lifted = { ...label, y: (label as { y: number }).y - row * size * 1.35 } as SceneElement;
    }
    placed.push(lifted);
    elements.push(dot, lifted);
  }
  return elements;
}
