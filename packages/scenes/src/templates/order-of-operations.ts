import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, markBeside, text } from "../layout/geometry";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import type { RectElement, Role, SceneElement, TextElement } from "../layout/types";
import { integer, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** ORDER_OF_OPERATIONS_LEFT_TO_RIGHT: "3 + 4 × 2: 3 + 4 is 7, then 7 × 2 is 14", not 11. */

const FOCUS = ["question", "student", "product", "strip", "rectangle", "slip", "answer"] as const;

interface Params {
  a: number;
  b: number;
  c: number;
  /** a + b, the student's first step, and (a + b) × c, their answer. */
  sum: number;
  wrong: number;
  /** b × c, and a + b × c. */
  product: number;
  answer: number;
}

const REGIONS = layoutFor({
  desktop: { text: { x: 0, y: 0, w: 0.43, h: 1 }, shape: { x: 0.49, y: 0, w: 0.51, h: 1 } },
  // On a phone the squares take the height the question and the notes leave between them.
  mobile: { text: { x: 0, y: 0, w: 1, h: 1 }, shape: { x: 0, y: 0, w: 1, h: 1 } },
});

/** The largest a unit square is drawn, so a small product does not fill the whole canvas. */
const MAX_UNIT = 88;

/**
 * A paragraph wrapped only between `pieces`, so a line never breaks inside a calculation ("7 ×"
 * at the end of one line and "2 = 14" on the next would be hard to read).
 */
function wrapPieces(
  id: string,
  role: Role,
  pieces: string[],
  region: Rect,
  top: number,
  size: number,
): TextElement {
  const lines: string[] = [];
  let line = "";
  for (const piece of pieces) {
    const candidate = line ? `${line} ${piece}` : piece;
    if (line && measureText(candidate, size).w > region.width) {
      lines.push(line);
      line = piece;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return {
    id,
    role,
    type: "text",
    x: region.x,
    y: top,
    w: Math.max(...lines.map((entry) => measureText(entry, size).w)),
    h: lines.length * LINE_HEIGHT * size,
    size,
    font: "body",
    align: "start",
    text: lines.join("\n"),
  };
}

/** Every element, by focus id; positions never depend on what is revealed. */
function layout(p: Params, format: SceneFormat): Record<string, SceneElement[]> {
  const size = WORKING;
  const region = regionRect(format, REGIONS[format].text);
  const out: Record<string, SceneElement[]> = {};
  const question = wrapPieces(
    "question",
    "given",
    ["Work", "out", `${p.a} + ${p.b} × ${p.c}.`],
    region,
    region.y,
    size,
  );
  const student = wrapPieces(
    "student.working",
    "student",
    ["You", "worked", "out", `${p.a} + ${p.b} = ${p.sum},`, `then ${p.sum} × ${p.c} = ${p.wrong}.`],
    region,
    question.y + question.h + size * 0.5,
    size,
  );
  out.question = [question];
  out.student = [student];

  let space: Rect;
  if (format === "desktop") {
    const notes = slipAndAnswer(p, region.x, bottomOf([student]) + size, region.width);
    out.slip = notes.slip;
    out.answer = notes.answer;
    space = regionRect(format, REGIONS.desktop.shape);
  } else {
    const trial = slipAndAnswer(p, region.x, 0, region.width);
    const notesTop = region.y + region.height - trial.bottom;
    const notes = slipAndAnswer(p, region.x, notesTop, region.width);
    out.slip = notes.slip;
    out.answer = notes.answer;
    const top = bottomOf([student]) + size * 0.5;
    space = { x: region.x, y: top, width: region.width, height: notesTop - size * 0.5 - top };
  }
  const squares = drawSquares(p, space);
  for (const [focus, elements] of Object.entries(squares)) {
    out[focus] = [...(out[focus] ?? []), ...elements];
  }
  return out;
}

/** "A common slip: adding 3 + 4 first", with a cross, then the working done in the right order. */
function slipAndAnswer(
  p: Params,
  left: number,
  top: number,
  width: number,
): { slip: SceneElement[]; answer: SceneElement[]; bottom: number } {
  const size = WORKING;
  const title = text("slip.title", "misconception", "A common slip:", left, top, {
    size,
    font: "pen",
    align: "start",
    valign: "top",
  });
  const words = `adding ${p.a} + ${p.b} first`;
  const beside = text(
    "slip.reasoning",
    "misconception",
    words,
    title.x + title.w + size * 0.3,
    title.y + title.h / 2,
    { size, align: "start" },
  );
  const reasoning =
    beside.x + beside.w + size * 1.3 <= left + width
      ? beside
      : text("slip.reasoning", "misconception", words, left, title.y + title.h + size * 0.1, {
          size,
          align: "start",
          valign: "top",
        });
  const mark = markBeside("slip.mark", "misconception", "cross", reasoning, size);
  const answerTop = Math.max(title.y + title.h, reasoning.y + reasoning.h) + size * 0.4;
  const answer = text(
    "answer.working",
    "correct",
    `${p.a} + ${p.b} × ${p.c} = ${p.a} + ${p.product} = ${p.answer}`,
    left,
    answerTop,
    { size, align: "start", valign: "top" },
  );
  const tick = markBeside("answer.mark", "correct", "tick", answer, size);
  return {
    slip: [title, reasoning, mark],
    answer: [answer, tick],
    bottom: answer.y + answer.h,
  };
}

/** One unit square, drawn a little inside its cell so the squares can be counted. */
function square(id: string, role: Role, x: number, y: number, unit: number): RectElement {
  const inset = Math.max(2, unit * 0.08);
  return {
    id,
    role,
    type: "rect",
    x: x + inset,
    y: y + inset,
    w: unit - 2 * inset,
    h: unit - 2 * inset,
    fill: true,
  };
}

/**
 * The squares: b × c as c rows of b on the right, a single row of a squares (the strip) on its
 * left, level with its bottom row. The student's (a + b) × c is the rectangle round both, which
 * fills the space above the strip: the a squares counted c times.
 */
function drawSquares(p: Params, space: Rect): Record<string, SceneElement[]> {
  const size = LABEL;
  const gap = size * 0.3;
  const labelH = LINE_HEIGHT * size;
  const pad = 8;
  const above = labelH + gap + pad;
  const below = pad + gap + labelH;
  const gapUnits = 0.5;
  const unit = Math.min(
    MAX_UNIT,
    (space.width - 2 * pad) / (p.a + p.b + gapUnits),
    (space.height - above - below) / p.c,
  );
  const width = (p.a + p.b + gapUnits) * unit;
  const height = p.c * unit;
  const left = space.x + (space.width - width) / 2;
  const top = space.y + above + (space.height - above - below - height) / 2;
  const bottom = top + height;
  const productLeft = left + (p.a + gapUnits) * unit;
  const right = left + width;

  const product: SceneElement[] = [];
  for (let row = 0; row < p.c; row += 1) {
    for (let col = 0; col < p.b; col += 1) {
      product.push(
        square(
          `product.r${row}c${col}`,
          "correct",
          productLeft + col * unit,
          top + row * unit,
          unit,
        ),
      );
    }
  }
  const strip: SceneElement[] = [];
  for (let col = 0; col < p.a; col += 1) {
    strip.push(square(`strip.c${col}`, "correct", left + col * unit, bottom - unit, unit));
  }
  // The rows the student's rectangle adds above the strip: the a squares again, c - 1 more times.
  const extra: SceneElement[] = [];
  for (let row = 0; row < p.c - 1; row += 1) {
    for (let col = 0; col < p.a; col += 1) {
      extra.push(
        square(`slip.r${row}c${col}`, "misconception", left + col * unit, top + row * unit, unit),
      );
    }
  }

  const labelTop = bottom + pad + gap;
  const stripLabel = text("strip.label", "correct", `${p.a}`, left + (p.a * unit) / 2, labelTop, {
    size,
    valign: "top",
  });
  const productText = `${p.b} × ${p.c} = ${p.product}`;
  const centred = text("product.label", "correct", productText, 0, labelTop, {
    size,
    align: "start",
    valign: "top",
  });
  const productX = Math.min(
    Math.max(productLeft + (p.b * unit - centred.w) / 2, stripLabel.x + stripLabel.w + gap * 2),
    space.x + space.width - centred.w,
  );
  const productLabel: TextElement = { ...centred, x: productX };

  const outline: RectElement = {
    id: "rectangle.outline",
    role: "student",
    type: "rect",
    x: left - pad,
    y: top - pad,
    w: width + 2 * pad,
    h: height + 2 * pad,
  };
  const studentText = text(
    "rectangle.label",
    "student",
    `${p.sum} × ${p.c} = ${p.wrong}`,
    0,
    top - pad - gap,
    { size, align: "start", valign: "bottom" },
  );
  const studentLabel: TextElement = {
    ...studentText,
    x: Math.min(
      Math.max((left + right) / 2 - studentText.w / 2, space.x),
      space.x + space.width - studentText.w,
    ),
  };
  return {
    product: [...product, productLabel],
    strip: [...strip, stripLabel],
    rectangle: [outline, studentLabel],
    slip: extra,
  };
}

export const orderOfOperations: SceneTemplate<Params> = {
  key: "area_model.order_of_operations",
  version: 1,
  primitive: "area_model",
  node: "N3",
  misconception: "ORDER_OF_OPERATIONS_LEFT_TO_RIGHT",
  itemTemplate: "n3-order-of-operations",
  title: "Multiply before you add",
  focusIds: FOCUS,
  beatKinds: withRefocusKinds(
    "show_given",
    "show_student_working",
    "build",
    "highlight_slip",
    "reveal_correct",
  ),

  params(item) {
    const a = integer(item, "a", 2, 12);
    const b = integer(item, "b", 2, 9);
    const c = integer(item, "c", 2, 9);
    return {
      a,
      b,
      c,
      sum: a + b,
      wrong: (a + b) * c,
      product: b * c,
      answer: a + b * c,
    };
  },

  spec(p, item, studentAnswer) {
    return {
      schema: "scene-spec/1",
      template: "area_model.order_of_operations@1",
      misconception: "ORDER_OF_OPERATIONS_LEFT_TO_RIGHT",
      params: item,
      studentAnswer,
      correctAnswer: p.answer,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Work out ${p.a} plus ${p.b} times ${p.c}.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You worked from left to right: ${p.a} plus ${p.b} is ${p.sum}, then ${p.sum} times ${p.c} is ${p.wrong}.`,
        },
        {
          kind: "build",
          focus: ["product"],
          narration: `Picture ${p.b} times ${p.c} as ${p.c} rows of ${p.b} squares. That makes ${p.product} squares.`,
        },
        {
          kind: "build",
          focus: ["strip"],
          narration: `The ${p.a} adds ${p.a} more single squares, set in one row beside the rectangle.`,
        },
        {
          kind: "highlight_slip",
          focus: ["rectangle", "slip"],
          narration: `A common slip: adding first. Your ${p.sum} times ${p.c} fills this bigger rectangle, so the ${p.a} squares are counted ${p.c} times over.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `Multiplication comes before addition, wherever it sits. So ${p.a} plus ${p.b} times ${p.c} is ${p.a} plus ${p.product}, which is ${p.answer}.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    const all = layout(p, format);
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // Left to right: a + b first, then times c.
    return p.wrong;
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Add", p.a, p.b], p.sum],
      ["Equal", ["Multiply", p.sum, p.c], p.wrong],
      ["Equal", ["Multiply", p.b, p.c], p.product],
      ["Equal", ["Add", p.a, p.product], p.answer],
      ["Equal", ["Add", p.a, ["Multiply", p.b, p.c]], p.answer],
      [
        "Equal",
        ["Multiply", ["Add", p.a, p.b], p.c],
        ["Add", ["Multiply", p.a, p.c], ["Multiply", p.b, p.c]],
      ],
    ];
  },

  sample: { item: { a: 3, b: 4, c: 2 }, studentAnswer: 14 },
};
