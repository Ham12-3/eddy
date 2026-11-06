/**
 * Compares the boxes the layout engine computed with the boxes a browser actually drew. Pure, so
 * it is unit-tested without a browser; keyframes.ts feeds it real DOM measurements.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One text element as the browser drew it, in CSS pixels relative to the canvas. */
export interface DrawnText {
  id: string;
  /** The positioned element: should match the layout box exactly. */
  box: Box;
  /** The glyphs themselves: must fit inside the box. */
  ink: Box;
}

export interface ExpectedText {
  id: string;
  /** The layout box, already scaled to CSS pixels. */
  box: Box;
}

export interface DomProblem {
  ids: string[];
  message: string;
}

/** Positioning error allowed for the element box (rounding of percentages). */
export const POSITION_TOLERANCE_PX = 1;
/** How far glyphs may stray outside their box (antialiasing, KaTeX's struts). */
export const INK_TOLERANCE_PX = 2;

function inside(outer: Box, inner: Box, tolerance: number): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function intersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function compareText(
  expected: readonly ExpectedText[],
  drawn: readonly DrawnText[],
  canvas: { width: number; height: number },
): DomProblem[] {
  const problems: DomProblem[] = [];
  const byId = new Map(drawn.map((item) => [item.id, item]));
  for (const want of expected) {
    const got = byId.get(want.id);
    if (!got) {
      problems.push({ ids: [want.id], message: "is in the layout but not on the page" });
      continue;
    }
    const off = Math.max(
      Math.abs(got.box.x - want.box.x),
      Math.abs(got.box.y - want.box.y),
      Math.abs(got.box.width - want.box.width),
      Math.abs(got.box.height - want.box.height),
    );
    if (off > POSITION_TOLERANCE_PX) {
      problems.push({
        ids: [want.id],
        message: `is drawn ${off.toFixed(1)} px away from its layout box`,
      });
    }
    if (got.ink.width > 0 && !inside(got.box, got.ink, INK_TOLERANCE_PX)) {
      problems.push({
        ids: [want.id],
        message: `its text (${got.ink.width.toFixed(1)} x ${got.ink.height.toFixed(1)} px) spills out of its box (${got.box.width.toFixed(1)} x ${got.box.height.toFixed(1)} px)`,
      });
    }
    if (!inside({ x: 0, y: 0, ...canvas }, got.ink, INK_TOLERANCE_PX)) {
      problems.push({ ids: [want.id], message: "its text goes past the edge of the canvas" });
    }
  }
  for (const item of drawn) {
    if (!expected.some((want) => want.id === item.id)) {
      problems.push({ ids: [item.id], message: "is on the page but not in the layout" });
    }
  }
  drawn.forEach((a, i) => {
    for (const b of drawn.slice(i + 1)) {
      if (a.ink.width > 0 && b.ink.width > 0 && intersect(a.ink, b.ink)) {
        problems.push({ ids: [a.id, b.id], message: "drawn text overlaps" });
      }
    }
  });
  return problems;
}
