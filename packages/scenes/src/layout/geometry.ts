import type { Rect } from "../canvas";
import { LINE_HEIGHT, measureMaths, measureText, wrapText } from "./measure";
import type {
  LineElement,
  MathNode,
  PolygonElement,
  Role,
  SceneElement,
  TextElement,
} from "./types";

/** Caveat runs small for its size, so teacher's-pen text is set this much larger. */
export const PEN_SCALE = 1.15;

/** A polygon's corners after its turn, if it has one. */
export function turnedPoints(element: PolygonElement): number[] {
  if (!element.turn || element.turn.degrees % 360 === 0) return element.points;
  const { cx, cy, degrees } = element.turn;
  // Anticlockwise on screen: the y axis points down.
  const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  const turned: number[] = [];
  for (let i = 0; i + 1 < element.points.length; i += 2) {
    const [dx, dy] = [(element.points[i] ?? 0) - cx, (element.points[i + 1] ?? 0) - cy];
    turned.push(cx + dx * cos + dy * sin, cy - dx * sin + dy * cos);
  }
  return turned;
}

/** The box an element covers, stroke included. */
export function bounds(element: SceneElement): Rect {
  switch (element.type) {
    case "line": {
      const pad = (element.width ?? 4) / 2 + (element.arrow ? 12 : 0);
      const x = Math.min(element.x1, element.x2) - pad;
      const y = Math.min(element.y1, element.y2) - pad;
      return {
        x,
        y,
        width: Math.abs(element.x2 - element.x1) + 2 * pad,
        height: Math.abs(element.y2 - element.y1) + 2 * pad,
      };
    }
    case "polygon": {
      const points = turnedPoints(element);
      const xs = points.filter((_, i) => i % 2 === 0);
      const ys = points.filter((_, i) => i % 2 === 1);
      const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
      return {
        x: minX - 2,
        y: minY - 2,
        width: Math.max(...xs) - minX + 4,
        height: Math.max(...ys) - minY + 4,
      };
    }
    case "circle":
      return {
        x: element.cx - element.r - 2,
        y: element.cy - element.r - 2,
        width: 2 * element.r + 4,
        height: 2 * element.r + 4,
      };
    case "arc":
      return {
        x: element.cx - element.r,
        y: element.cy - element.r,
        width: 2 * element.r,
        height: 2 * element.r,
      };
    case "rect":
    case "text":
    case "mark":
      return { x: element.x, y: element.y, width: element.w, height: element.h };
  }
}

export function overlaps(a: Rect, b: Rect, tolerance = 0): boolean {
  return (
    a.x + tolerance < b.x + b.width &&
    b.x + tolerance < a.x + a.width &&
    a.y + tolerance < b.y + b.height &&
    b.y + tolerance < a.y + a.height
  );
}

export function contains(outer: Rect, inner: Rect, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export type Anchor = "start" | "middle" | "end";
export type VerticalAnchor = "top" | "middle" | "bottom";

export interface TextOptions {
  size: number;
  font?: "body" | "pen";
  align?: Anchor;
  valign?: VerticalAnchor;
  inside?: string;
}

/** A text label whose box is measured and anchored at (x, y). */
export function text(
  id: string,
  role: Role,
  content: string | MathNode[],
  x: number,
  y: number,
  options: TextOptions,
): TextElement {
  const font = options.font ?? "body";
  const fontSize = font === "pen" ? options.size * PEN_SCALE : options.size;
  const size =
    typeof content === "string"
      ? measureText(content, fontSize, font)
      : measureMaths(content, fontSize);
  const align = options.align ?? "middle";
  const valign = options.valign ?? "middle";
  const left = align === "start" ? x : align === "middle" ? x - size.w / 2 : x - size.w;
  const top = valign === "top" ? y : valign === "middle" ? y - size.h / 2 : y - size.h;
  return {
    id,
    role,
    type: "text",
    x: left,
    y: top,
    w: size.w,
    h: size.h,
    size: fontSize,
    font,
    align,
    ...(typeof content === "string" ? { text: content } : { maths: content }),
    ...(options.inside ? { inside: options.inside } : {}),
  };
}

export type Side = "above" | "below" | "left" | "right";

/**
 * A label next to a target box, on the first side where it fits inside `within` without
 * touching anything in `avoid` (spatial contiguity: labels sit next to their objects).
 */
export function labelNear(
  id: string,
  role: Role,
  content: string | MathNode[],
  target: Rect,
  options: TextOptions & { sides: Side[]; within: Rect; avoid?: Rect[]; gap?: number },
): TextElement {
  const gap = options.gap ?? options.size * 0.3;
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  let first: TextElement | undefined;
  for (const side of options.sides) {
    const placed =
      side === "above"
        ? text(id, role, content, cx, target.y - gap, {
            ...options,
            align: "middle",
            valign: "bottom",
          })
        : side === "below"
          ? text(id, role, content, cx, target.y + target.height + gap, {
              ...options,
              align: "middle",
              valign: "top",
            })
          : side === "left"
            ? text(id, role, content, target.x - gap, cy, {
                ...options,
                align: "end",
                valign: "middle",
              })
            : text(id, role, content, target.x + target.width + gap, cy, {
                ...options,
                align: "start",
                valign: "middle",
              });
    first ??= placed;
    const box = bounds(placed);
    if (
      contains(options.within, box) &&
      !(options.avoid ?? []).some((other) => overlaps(box, other))
    ) {
      return placed;
    }
  }
  // Nothing fitted: return the first choice, and let the static checks report it.
  return first as TextElement;
}

/** Text wrapped to `maxWidth`, as one element whose box holds every line. */
export function paragraph(
  id: string,
  role: Role,
  content: string,
  x: number,
  y: number,
  maxWidth: number,
  options: TextOptions,
): TextElement {
  const font = options.font ?? "body";
  const fontSize = font === "pen" ? options.size * PEN_SCALE : options.size;
  const lines = wrapText(content, fontSize, maxWidth, font);
  const width = Math.max(...lines.map((line) => measureText(line, fontSize, font).w));
  const height = lines.length * LINE_HEIGHT * fontSize;
  const align = options.align ?? "start";
  const left = align === "start" ? x : align === "middle" ? x - width / 2 : x - width;
  const valign = options.valign ?? "top";
  const top = valign === "top" ? y : valign === "middle" ? y - height / 2 : y - height;
  return {
    id,
    role,
    type: "text",
    x: left,
    y: top,
    w: width,
    h: height,
    size: fontSize,
    font,
    align,
    text: lines.join("\n"),
    ...(options.inside ? { inside: options.inside } : {}),
  };
}

export interface StackItem {
  id: string;
  role: Role;
  content: string | MathNode[];
  font?: "body" | "pen";
}

/** Lines of working, stacked from the top of a region; words wrap to the region's width. */
export function stack(
  items: StackItem[],
  region: Rect,
  options: TextOptions & { spacing?: number },
): TextElement[] {
  const elements: TextElement[] = [];
  let y = region.y;
  const align = options.align ?? "start";
  const x =
    align === "start"
      ? region.x
      : align === "middle"
        ? region.x + region.width / 2
        : region.x + region.width;
  for (const item of items) {
    const itemOptions = {
      ...options,
      align,
      valign: "top" as const,
      font: item.font ?? options.font,
    };
    const element =
      typeof item.content === "string"
        ? paragraph(item.id, item.role, item.content, x, y, region.width, itemOptions)
        : text(item.id, item.role, item.content, x, y, itemOptions);
    elements.push(element);
    y += element.h + (options.spacing ?? options.size * 0.3);
  }
  return elements;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Shared by the primitives and templates (moved out of the angle diagram and the grid).

export interface Point {
  x: number;
  y: number;
}

/** The point `distance` away from `from`, in the direction `degrees`. */
export function toward(from: Point, degrees: number, distance: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return { x: from.x + distance * Math.cos(radians), y: from.y - distance * Math.sin(radians) };
}

/** The longest run, across or down, that one piece of a slanted line may cover. */
const PIECE = 24;

/**
 * A straight line drawn as short pieces. The overlap checks compare boxes, and one slanted line's
 * box covers the whole rectangle it crosses; each short piece's box hugs the line, so a label can
 * sit beside it. Pieces have round caps, so together they draw as one line.
 */
export function slantedLine(
  id: string,
  role: Role,
  from: Point,
  to: Point,
  options: { width?: number } = {},
): LineElement[] {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const count = Math.max(1, Math.ceil(Math.min(Math.abs(dx), Math.abs(dy)) / PIECE));
  return Array.from({ length: count }, (_, i) => ({
    id: count === 1 ? id : `${id}.${i}`,
    role,
    type: "line" as const,
    x1: from.x + (dx * i) / count,
    y1: from.y + (dy * i) / count,
    x2: from.x + (dx * (i + 1)) / count,
    y2: from.y + (dy * (i + 1)) / count,
    ...(options.width ? { width: options.width } : {}),
  }));
}

/**
 * A straight line drawn as short pieces (ids `${id}.0`, `${id}.1`, ...). A slanting line's box
 * would cover the whole area it crosses, so labels could never sit beside it; each short piece
 * has a small box, so the overlap checks see where the line really is.
 */
export function segmentedLine(
  id: string,
  role: Role,
  from: [number, number],
  to: [number, number],
  options: { width?: number; piece?: number } = {},
): LineElement[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const count = Math.max(1, Math.ceil(length / (options.piece ?? 24)));
  return Array.from({ length: count }, (_, i) => ({
    id: `${id}.${i}`,
    role,
    type: "line" as const,
    x1: lerp(from[0], to[0], i / count),
    y1: lerp(from[1], to[1], i / count),
    x2: lerp(from[0], to[0], (i + 1) / count),
    y2: lerp(from[1], to[1], (i + 1) / count),
    ...(options.width ? { width: options.width } : {}),
  }));
}

/** A box grown by `margin` on every side. */
export function grow(box: Rect, margin: number): Rect {
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
}

/**
 * The box for a pen ring (an ellipse) round `box` that clears its corners. The margin is fixed
 * on one side ("across" for a wide label, so the ring stays clear of lines above and below it;
 * "down" for a card in a row, so it stays clear of its neighbours) and the other side is worked out.
 */
export function ringRound(box: Rect, margin: number, fixed: "across" | "down"): Rect {
  const [halfW, halfH] = [box.width / 2, box.height / 2];
  const [rx, ry] =
    fixed === "across"
      ? [halfW / Math.sqrt(1 - (halfH / (halfH + margin)) ** 2), halfH + margin]
      : [halfW + margin, halfH / Math.sqrt(1 - (halfW / (halfW + margin)) ** 2)];
  const [cx, cy] = [box.x + halfW, box.y + halfH];
  return { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
}

/** The lowest edge of a set of elements. */
export function bottomOf(elements: readonly SceneElement[]): number {
  return Math.max(...elements.map((element) => bounds(element).y + bounds(element).height));
}

/** A pen mark (a cross or a tick) just after a line of working. */
export function markBeside(
  id: string,
  role: "misconception" | "correct",
  kind: "cross" | "tick",
  line: TextElement,
  size: number,
): SceneElement {
  return {
    id,
    role,
    type: "mark",
    kind,
    x: line.x + line.w + size * 0.3,
    y: line.y + line.h * 0.1,
    w: size * 0.8,
    h: line.h * 0.8,
  };
}
