import type { Rect } from "../canvas";
import { bounds, grow, overlaps, type Point, slantedLine, text } from "../layout/geometry";
import type {
  MathNode,
  PolygonElement,
  RectElement,
  Role,
  SceneElement,
  TextElement,
} from "../layout/types";

/**
 * Pythagoras squares: a right-angled triangle with its shorter sides across and up, and a square
 * drawn outwards on each side. The figure is drawn to scale and as large as the region allows,
 * leaving room for the side-length labels that sit outside the squares: left of the square on the
 * side up, and right of the square on the side across (under the hypotenuse's square).
 */

export interface PythagorasOptions {
  /** Ids for the triangle's parts and for the squares. */
  triangleId: string;
  squaresId: string;
  region: Rect;
  /** The two shorter sides; the longer of the two orientations that fits better is chosen. */
  a: number;
  b: number;
  size: number;
  /** The widest side-length label, so the figure leaves room for it. */
  labelWidth: number;
}

export interface PythagorasFigure {
  /** Canvas units per unit of length. */
  scale: number;
  /** The side lengths running across (from the right angle) and up. */
  across: number;
  up: number;
  /** The right angle, the far end of the side across, and the top of the side up. */
  corner: Point;
  acrossEnd: Point;
  upEnd: Point;
  triangle: SceneElement[];
  /** The hypotenuse drawn over the triangle's, as pieces in the given role and width. */
  hypotenuse: (id: string, role: Role, width: number) => SceneElement[];
  squareAcross: RectElement;
  squareUp: RectElement;
  squareHyp: PolygonElement;
  /** The midpoint of the hypotenuse and the unit normal pointing out into its square. */
  hypMid: Point;
  outward: Point;
  hypLength: number;
}

function extents(across: number, up: number): { width: number; height: number } {
  // Square up sits left of the triangle; square across sits below; the hypotenuse's square
  // reaches up and to the right.
  return { width: across + 2 * up, height: 2 * across + up };
}

export function pythagorasFigure(options: PythagorasOptions): PythagorasFigure {
  const { size, labelWidth } = options;
  // Strokes and polygon boxes reach a little past the shapes: keep them inside the region.
  const region = grow(options.region, -4);
  const gap = size * 0.3;
  const label = labelWidth + gap;
  // The label right of square across needs room past the hypotenuse's square only when the side
  // up is shorter than the label is wide.
  const fit = (across: number, up: number) => {
    const extent = extents(across, up);
    const scale = Math.min((region.width - label) / extent.width, region.height / extent.height);
    return up * scale >= label
      ? scale
      : Math.min(scale, (region.width - 2 * label) / (across + up));
  };
  const [across, up] =
    fit(options.a, options.b) >= fit(options.b, options.a)
      ? [options.a, options.b]
      : [options.b, options.a];
  const scale = fit(across, up);
  const [A, B] = [across * scale, up * scale];
  const extent = extents(A, B);
  const width = label + Math.max(extent.width, A + B + label);
  // Centre the figure, with its labels, in the region.
  const left = region.x + (region.width - width) / 2 + label;
  const top = region.y + (region.height - extent.height) / 2;
  const corner = { x: left + B, y: top + A + B };
  const acrossEnd = { x: corner.x + A, y: corner.y };
  const upEnd = { x: corner.x, y: corner.y - B };
  const tick = Math.min(size * 0.45, A * 0.3, B * 0.3);
  const triangle: SceneElement[] = [
    {
      id: `${options.triangleId}.across`,
      role: "given",
      type: "line",
      x1: corner.x,
      y1: corner.y,
      x2: acrossEnd.x,
      y2: acrossEnd.y,
    },
    {
      id: `${options.triangleId}.up`,
      role: "given",
      type: "line",
      x1: corner.x,
      y1: corner.y,
      x2: upEnd.x,
      y2: upEnd.y,
    },
    ...slantedLine(`${options.triangleId}.hypotenuse`, "given", acrossEnd, upEnd),
    {
      id: `${options.triangleId}.rightAngle`,
      role: "given",
      type: "polygon",
      open: true,
      points: [
        corner.x + tick,
        corner.y,
        corner.x + tick,
        corner.y - tick,
        corner.x,
        corner.y - tick,
      ],
    },
  ];
  const hypLength = Math.hypot(A, B);
  // Out of the triangle, away from the right angle: (B, -A) per unit of hypotenuse.
  const outward = { x: B / hypLength, y: -A / hypLength };
  const shift = { x: B, y: -A };
  return {
    scale,
    across,
    up,
    corner,
    acrossEnd,
    upEnd,
    triangle,
    hypotenuse: (id, role, width) => slantedLine(id, role, acrossEnd, upEnd, { width }),
    squareAcross: {
      id: `${options.squaresId}.across`,
      role: "structure",
      type: "rect",
      x: corner.x,
      y: corner.y,
      w: A,
      h: A,
    },
    squareUp: {
      id: `${options.squaresId}.up`,
      role: "structure",
      type: "rect",
      x: corner.x - B,
      y: upEnd.y,
      w: B,
      h: B,
    },
    squareHyp: {
      id: `${options.squaresId}.hypotenuse`,
      role: "structure",
      type: "polygon",
      points: [
        acrossEnd.x,
        acrossEnd.y,
        upEnd.x,
        upEnd.y,
        upEnd.x + shift.x,
        upEnd.y + shift.y,
        acrossEnd.x + shift.x,
        acrossEnd.y + shift.y,
      ],
    },
    hypMid: { x: (acrossEnd.x + upEnd.x) / 2, y: (acrossEnd.y + upEnd.y) / 2 },
    outward,
    hypLength,
  };
}

/** Whether a point lies inside a convex polygon given as x0, y0, x1, y1, ... */
function insideConvex(points: readonly number[], point: Point): boolean {
  let sign = 0;
  const count = points.length / 2;
  for (let i = 0; i < count; i += 1) {
    const [x1, y1] = [points[2 * i]!, points[2 * i + 1]!];
    const [x2, y2] = [points[2 * ((i + 1) % count)]!, points[2 * ((i + 1) % count) + 1]!];
    const cross = (x2 - x1) * (point.y - y1) - (y2 - y1) * (point.x - x1);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** Whether a box, grown by `margin`, lies inside a convex polygon. */
export function boxInside(polygon: PolygonElement, box: Rect, margin: number): boolean {
  const grown = grow(box, margin);
  return [
    { x: grown.x, y: grown.y },
    { x: grown.x + grown.width, y: grown.y },
    { x: grown.x, y: grown.y + grown.height },
    { x: grown.x + grown.width, y: grown.y + grown.height },
  ].every((corner) => insideConvex(polygon.points, corner));
}

/**
 * A label inside the hypotenuse's square, as near as it can sit to a target spot without
 * touching anything in `avoid` (each grown by `margin`) and wholly inside the square. Spots are
 * given in the square's own terms: `along` the hypotenuse from its end across (0 to 1), and `out`
 * from the hypotenuse towards the far side (0 to 1).
 */
export function labelInHypSquare(
  figure: PythagorasFigure,
  id: string,
  role: Role,
  /** The words, or a label already laid out (such as a two-line one) to move into place. */
  content: string | MathNode[] | TextElement,
  options: {
    size: number;
    target: { along: number; out: number };
    avoid: readonly Rect[];
    margin: number;
  },
): TextElement | undefined {
  const base =
    typeof content === "object" && !Array.isArray(content)
      ? {
          ...content,
          id,
          role,
          x: -content.w / 2,
          y: -content.h / 2,
          inside: figure.squareHyp.id,
        }
      : text(id, role, content, 0, 0, { size: options.size, inside: figure.squareHyp.id });
  const side = figure.hypLength;
  const run = {
    x: (figure.upEnd.x - figure.acrossEnd.x) / side,
    y: (figure.upEnd.y - figure.acrossEnd.y) / side,
  };
  const spot = (along: number, out: number) => ({
    x: figure.acrossEnd.x + run.x * along * side + figure.outward.x * out * side,
    y: figure.acrossEnd.y + run.y * along * side + figure.outward.y * out * side,
  });
  const target = spot(options.target.along, options.target.out);
  const avoid = options.avoid.map((other) => grow(other, options.margin));
  const steps = 40;
  let best: { label: TextElement; score: number } | undefined;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const centre = spot(i / steps, j / steps);
      const label = { ...base, x: base.x + centre.x, y: base.y + centre.y };
      const box = bounds(label);
      if (
        !boxInside(figure.squareHyp, box, options.margin) ||
        avoid.some((other) => overlaps(box, other))
      )
        continue;
      const score = Math.hypot(centre.x - target.x, centre.y - target.y);
      if (!best || score < best.score) best = { label, score };
    }
  }
  return best?.label;
}
