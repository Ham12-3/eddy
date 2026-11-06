import type { Rect } from "../canvas";
import { text } from "../layout/geometry";
import { LINE_HEIGHT, measureMaths, measureText } from "../layout/measure";
import type { MathNode, Role, SceneElement } from "../layout/types";

/**
 * Balance: a level beam on a pivot with a pan of blocks at each end. The two sides of an equation
 * sit on the two pans; doing the same to both sides keeps the beam level. Blocks are rectangles
 * with their label inside; x tiles are squares marked x.
 */

export interface BalanceOptions {
  region: Rect;
  /** Label size in canvas units. */
  size: number;
  /** Rows of blocks the pans must hold, so the beam sits low enough for the tallest pile. */
  rows: number;
}

export interface Balance {
  elements: SceneElement[];
  /** Top of the beam, where blocks rest. */
  rest: number;
  /** Middle of each pan. */
  left: number;
  right: number;
  /** Width each pan may fill. */
  span: number;
  /** Side of an x tile, and the gap between blocks. */
  tile: number;
  gap: number;
  /** Where a label above the piles goes (its bottom). */
  above: number;
}

export function balance(id: string, options: BalanceOptions): Balance {
  const { region, size } = options;
  const tile = Math.max(size * 1.6, LINE_HEIGHT * size + size * 0.3);
  const gap = size * 0.2;
  const beam = 8;
  const pivotH = size * 1.2;
  const pivotW = pivotH * 1.3;
  // Shapes are drawn with a stroke: keep the pivot a few units inside the region.
  const base = region.y + region.height - 4;
  const beamY = base - pivotH - beam / 2;
  const middle = region.x + region.width / 2;
  const elements: SceneElement[] = [
    {
      id: `${id}.pivot`,
      role: "structure",
      type: "polygon",
      points: [middle, beamY + beam / 2, middle - pivotW / 2, base, middle + pivotW / 2, base],
      fill: true,
    },
    {
      id: `${id}.beam`,
      role: "structure",
      type: "line",
      x1: region.x + 4,
      y1: beamY,
      x2: region.x + region.width - 4,
      y2: beamY,
      width: beam,
    },
  ];
  const rest = beamY - beam / 2 - 2;
  return {
    elements,
    rest,
    left: region.x + region.width * 0.25,
    right: region.x + region.width * 0.75,
    span: region.width / 2 - pivotW,
    tile,
    gap,
    above: rest - options.rows * (tile + gap) - gap,
  };
}

export interface Block {
  id: string;
  role: Role;
  /** Words or maths inside the block. */
  label: string | MathNode[];
  width: number;
}

/** How wide a block must be to hold its label with room around it. */
export function blockWidth(label: string | MathNode[], size: number, tile: number): number {
  const inner =
    typeof label === "string" ? measureText(label, size).w : measureMaths(label, size).w;
  return Math.max(tile, inner + size * 0.5);
}

/**
 * Blocks in rows on a pan, filled from the bottom row up and left to right, the whole pile
 * centred on `centre`. `columns` blocks to a row. Each block is a rectangle `${id}` with its
 * label `${id}.label` inside it. Returns the elements and each block's box, in order.
 */
export function pile(
  blocks: readonly Block[],
  centre: number,
  rest: number,
  columns: number,
  tile: number,
  gap: number,
  size: number,
): { elements: SceneElement[]; boxes: Rect[] } {
  const width = Math.max(...blocks.map((block) => block.width));
  const across = Math.min(columns, blocks.length);
  const total = across * width + (across - 1) * gap;
  const start = centre - total / 2;
  const elements: SceneElement[] = [];
  const boxes: Rect[] = [];
  blocks.forEach((block, i) => {
    const [row, column] = [Math.floor(i / columns), i % columns];
    const box = {
      x: start + column * (width + gap),
      y: rest - (row + 1) * tile - row * gap,
      width,
      height: tile,
    };
    boxes.push(box);
    elements.push(
      {
        id: block.id,
        role: block.role,
        type: "rect",
        x: box.x,
        y: box.y,
        w: box.width,
        h: box.height,
        // Only ink blocks are tinted: coloured text on a coloured tint would be too faint.
        fill: block.role === "given",
      },
      text(
        `${block.id}.label`,
        block.role,
        block.label,
        box.x + box.width / 2,
        box.y + box.height / 2,
        { size, inside: block.id },
      ),
    );
  });
  return { elements, boxes };
}

/** The fewest rows, and the columns they need, for `count` blocks of `width` in `span` beside `extra`. */
export function arrange(
  count: number,
  width: number,
  gap: number,
  span: number,
  extra = 0,
): { rows: number; columns: number } {
  for (let rows = 1; rows <= count; rows += 1) {
    const columns = Math.ceil(count / rows);
    if (columns * width + (columns - 1) * gap + extra <= span) return { rows, columns };
  }
  return { rows: count, columns: 1 };
}
