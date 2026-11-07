import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber, mathNumber, MINUS } from "../layout/format";
import { text } from "../layout/geometry";
import { LINE_HEIGHT, measureMaths } from "../layout/measure";
import type { MathNode, SceneElement, TextElement } from "../layout/types";
import { arrange, balance, blockWidth, pile, type Block } from "../primitives/balance";
import { gcd, integer, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";
import { focusOf } from "./template";

/** EQ_DIVIDE_ONE_TERM: 2x + 11 = 31 becomes x + 11 = 31/2, so x = 9/2 (not 10). */

interface Params {
  a: number;
  b: number;
  c: number;
  x: number;
}

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.48, h: 0.46 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.46 },
    balance: { x: 0, y: 0.5, w: 1, h: 0.5 },
  },
  // On a phone the balance takes the height the working and the notes leave between them.
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    balance: { x: 0, y: 0, w: 1, h: 1 },
  },
});

/** n/d in lowest terms as a maths label, the sign in front. */
function fraction(n: number, d: number): MathNode[] {
  const g = gcd(n, d);
  const [top, bottom] = [Math.abs(n / g), Math.abs(d / g)];
  const negative = n * d < 0;
  if (bottom === 1) return [mathNumber(negative ? -top : top)];
  return [...(negative ? [{ op: "−" }] : []), { frac: [[mathNumber(top)], [mathNumber(bottom)]] }];
}

/** n/d as a student writes it after dividing: whole when it divides exactly, else unsimplified. */
function asWritten(n: number, d: number): MathNode[] {
  if (n % d === 0) return [mathNumber(n / d)];
  return [...(n < 0 ? [{ op: "−" }] : []), { frac: [[mathNumber(Math.abs(n))], [mathNumber(d)]] }];
}

/** The same for narration: "45/6", "−29/6", "8". */
function writtenWords(n: number, d: number): string {
  return n % d === 0 ? formatNumber(n / d) : `${n < 0 ? MINUS : ""}${Math.abs(n)}/${d}`;
}

/**
 * The balance only for equations where every quantity is a positive weight. A negative block
 * or an x tile worth a negative amount breaks the picture, so those equations are worked in
 * columns instead: the same beats, the same slip, the same idea of doing the same to each side.
 */
function usesScales(p: Params): boolean {
  return p.b > 0 && p.x > 0;
}

/** n/d in lowest terms for narration: "31/2", "−62/9", "8". */
function fractionWords(n: number, d: number): string {
  const g = gcd(n, d);
  const [top, bottom] = [n / g, d / g];
  const sign = top * bottom < 0 ? MINUS : "";
  return Math.abs(bottom) === 1
    ? formatNumber(top / bottom)
    : `${sign}${Math.abs(top)}/${Math.abs(bottom)}`;
}

/** n/d in lowest terms as MathJSON. */
function fractionJson(n: number, d: number): JsonValue {
  const g = gcd(n, d) * Math.sign(d);
  return d / g === 1 ? n / g : ["Rational", n / g, d / g];
}

/** "+ 11" or "− 3": the constant term after the x term. */
function signed(b: number): [string, string] {
  return [b < 0 ? "−" : "+", formatNumber(Math.abs(b))];
}

function equation(p: Params): string {
  const [sign, size] = signed(p.b);
  return `${p.a}x ${sign} ${size} = ${formatNumber(p.c)}`;
}

/** Elements that a later beat takes away: what is taken from both sides, then the old totals. */
const UNTIL: [string, string][] = [
  ["balance.ones", "subtract"],
  ["balance.total", "subtract"],
  ["subtract.block", "divide"],
  ["subtract.left", "divide"],
  ["subtract.right", "divide"],
];

/** Every element of the scene, in one format; `draw` shows those whose focus id is revealed. */
function layout(p: Params, format: SceneFormat): SceneElement[] {
  const regions = REGIONS[format];
  const size = WORKING;
  const textRegion = regionRect(format, regions.text);
  const [sign, constant] = signed(p.b);
  const question = text("question", "given", `Solve ${equation(p)}.`, textRegion.x, textRegion.y, {
    size,
    align: "start",
    valign: "top",
  });

  // The student's working: x + 11 = 31/2, then x = 9/2.
  const before: MathNode[] = [{ sym: "x" }];
  const term: MathNode[] = [{ op: sign }, { num: constant }];
  const firstLine: MathNode[] = [...before, ...term, { op: "=" }, ...asWritten(p.c, p.a)];
  const secondLine: MathNode[] = [{ sym: "x" }, { op: "=" }, ...fraction(p.c - p.a * p.b, p.a)];
  const oneLine: MathNode[] = [...firstLine, { op: "," }, { text: " so " }, ...secondLine];
  const studentTop = question.y + question.h + size * 0.5;
  const together = measureMaths(oneLine, size).w <= textRegion.width && format === "mobile";
  const student: TextElement[] = together
    ? [
        text("student.working", "student", oneLine, textRegion.x, studentTop, {
          size,
          align: "start",
          valign: "top",
        }),
      ]
    : [
        text("student.working", "student", firstLine, textRegion.x, studentTop, {
          size,
          align: "start",
          valign: "top",
        }),
        text(
          "student.answer",
          "student",
          secondLine,
          textRegion.x,
          studentTop + measureMaths(firstLine, size).h + size * 0.2,
          {
            size,
            align: "start",
            valign: "top",
          },
        ),
      ];
  const working = student[0] as TextElement;
  const studentBottom = Math.max(...student.map((line) => line.y + line.h));
  // The slip ringed where it happened: the constant term the student did not divide.
  const pad = 0.1 * size;
  const termLeft = working.x + measureMaths(before, size).w - pad;
  const termWidth = measureMaths(term, size).w - pad;
  const ringH = LINE_HEIGHT * size * 1.05;
  const ring: SceneElement = {
    id: "slip.ring",
    role: "misconception",
    type: "mark",
    kind: "ring",
    // The sign has a little space before it: start the ring in that space, clear of the x.
    x: termLeft + size * 0.14,
    y: working.y + working.h / 2 - ringH / 2,
    w: termWidth + size * 0.02,
    h: ringH,
  };

  const notesRegion = regionRect(format, regions.notes);
  const picture = usesScales(p) ? scales : columns;
  // The columns are themselves the corrected working, so only the scales need it written out.
  const withWorking = usesScales(p);
  if (format === "desktop") {
    const notes = slipAndWorking(p, notesRegion.x, notesRegion.y, notesRegion.width, withWorking);
    return [
      question,
      ...student,
      ring,
      ...notes.elements,
      ...picture(p, regionRect(format, regions.balance)),
    ];
  }
  const trial = slipAndWorking(p, textRegion.x, 0, textRegion.width, withWorking);
  const notesTop = textRegion.y + textRegion.height - trial.bottom;
  const notes = slipAndWorking(p, textRegion.x, notesTop, textRegion.width, withWorking);
  const top = studentBottom + size * 0.6;
  const space = {
    x: textRegion.x,
    y: top,
    width: textRegion.width,
    height: notesTop - size * 0.6 - top,
  };
  return [question, ...student, ring, ...notes.elements, ...picture(p, space)];
}

/** "A common slip: 11 not divided by 2", then the corrected working, 2x = 20 and x = 10. */
function slipAndWorking(
  p: Params,
  left: number,
  top: number,
  width: number,
  withWorking: boolean,
): { elements: SceneElement[]; bottom: number } {
  const size = WORKING;
  const title = text("slip.title", "misconception", "A common slip:", left, top, {
    size,
    font: "pen",
    align: "start",
    valign: "top",
  });
  const words = `${formatNumber(p.b)} not divided by ${p.a}`;
  const beside = text(
    "slip.reasoning",
    "misconception",
    words,
    title.x + title.w + size * 0.3,
    title.y + title.h / 2,
    { size, align: "start" },
  );
  const reasoning =
    beside.x + beside.w <= left + width
      ? beside
      : text("slip.reasoning", "misconception", words, left, title.y + title.h + size * 0.1, {
          size,
          align: "start",
          valign: "top",
        });
  const slipBottom = Math.max(title.y + title.h, reasoning.y + reasoning.h);
  if (!withWorking) return { elements: [title, reasoning], bottom: slipBottom };
  const workingTop = slipBottom + size * 0.4;
  const subtract = text(
    "subtract.working",
    "correct",
    [mathNumber(p.a), { sym: "x" }, { op: "=" }, mathNumber(p.c - p.b)],
    left,
    workingTop,
    { size, align: "start", valign: "top" },
  );
  const answer = [{ sym: "x" }, { op: "=" }, mathNumber(p.x)] satisfies MathNode[];
  const sameRow = text(
    "divide.working",
    "correct",
    answer,
    subtract.x + subtract.w + size,
    workingTop,
    { size, align: "start", valign: "top" },
  );
  const divide =
    sameRow.x + sameRow.w <= left + width
      ? sameRow
      : text("divide.working", "correct", answer, left, subtract.y + subtract.h + size * 0.2, {
          size,
          align: "start",
          valign: "top",
        });
  return {
    elements: [title, reasoning, subtract, divide],
    bottom: Math.max(subtract.y + subtract.h, divide.y + divide.h),
  };
}

/**
 * The equation in columns, the way it is set out in a book: the left side, "=", the right side,
 * with what is done written under each side. Then 6x = −24, then x = −4.
 */
function columns(p: Params, space: Rect): SceneElement[] {
  const size = WORKING;
  const small = LABEL;
  const gap = size * 0.3;
  const [sign, constant] = signed(p.b);
  const row = (id: string, role: "given" | "correct", left: MathNode[], right: MathNode[]) => ({
    id,
    role,
    left,
    right,
  });
  const rows = [
    row(
      "balance",
      "given",
      [mathNumber(p.a), { sym: "x" }, { op: sign }, { num: constant }],
      [mathNumber(p.c)],
    ),
    row("subtract", "correct", [mathNumber(p.a), { sym: "x" }], [mathNumber(p.c - p.b)]),
    row("divide", "correct", [{ sym: "x" }], [mathNumber(p.x)]),
  ];
  const take = `${sign === "+" ? "−" : "+"} ${constant}`;
  const operations: Record<string, string> = { subtract: take, divide: `÷ ${p.a}` };
  const captionH = LINE_HEIGHT * small;
  const rowH = LINE_HEIGHT * size;
  const height = captionH + gap + rows.length * rowH + (rows.length - 1) * (captionH + gap * 2);
  const top = space.y + Math.max(0, (space.height - height) / 2);
  const middle = space.x + space.width / 2;
  const equalsW = measureMaths([{ op: "=" }], size).w;
  const [leftEdge, rightEdge] = [
    middle - equalsW / 2 - gap * 0.5,
    middle + equalsW / 2 + gap * 0.5,
  ];
  const elements: SceneElement[] = [
    text("balance.leftCaption", "given", "left side", leftEdge, top, {
      size: small,
      align: "end",
      valign: "top",
    }),
    text("balance.rightCaption", "given", "right side", rightEdge, top, {
      size: small,
      align: "start",
      valign: "top",
    }),
  ];
  let y = top + captionH + gap;
  rows.forEach((line, i) => {
    const operation = operations[line.id];
    if (i > 0 && operation) {
      // What is done to each side, written under that side.
      elements.push(
        text(`${line.id}.leftOp`, "correct", operation, leftEdge, y + gap, {
          size: small,
          align: "end",
          valign: "top",
        }),
        text(`${line.id}.rightOp`, "correct", operation, rightEdge, y + gap, {
          size: small,
          align: "start",
          valign: "top",
        }),
      );
      y += captionH + gap * 2;
    }
    const left = text(`${line.id}.rowLeft`, line.role, line.left, leftEdge, y, {
      size,
      align: "end",
      valign: "top",
    });
    const right = text(`${line.id}.rowRight`, line.role, line.right, rightEdge, y, {
      size,
      align: "start",
      valign: "top",
    });
    elements.push(
      left,
      text(`${line.id}.rowEquals`, line.role, [{ op: "=" }], middle, y, { size, valign: "top" }),
      right,
    );
    if (line.id === "divide") {
      const pad = size * 0.3;
      elements.push({
        id: "divide.ring",
        role: "correct",
        type: "mark",
        kind: "ring",
        x: left.x - pad,
        y: left.y - pad * 0.5,
        w: right.x + right.w - left.x + pad * 2,
        h: left.h + pad,
      });
    }
    y += rowH;
  });
  return elements;
}

/** The balance: a x tiles and the constant on the left, the total on the right; then the steps. */
function scales(p: Params, space: Rect): SceneElement[] {
  const size = LABEL;
  const probe = balance("balance", { region: space, size, rows: 1 });
  const { tile, gap, span } = probe;
  const [sign, constant] = signed(p.b);
  const onesW = blockWidth(formatNumber(p.b), size, tile);
  const totalW = blockWidth(formatNumber(p.c), size, tile * 1.5);
  const remainderW = blockWidth(formatNumber(p.c - p.b), size, tile * 1.5);
  const shareW = blockWidth(formatNumber(p.x), size, tile);
  const left = arrange(p.a, tile, gap, span, gap * 2 + onesW);
  // The shares on the right copy the tiles on the left, so each x has its own share.
  const columns = left.columns;
  const rows = left.rows;
  // The balance sits in the middle of its space: the labels above the piles, the piles, the beam
  // and the pivot, with the space shared out above and below.
  const height = Math.min(
    space.height,
    LINE_HEIGHT * size + gap * 3 + rows * (tile + gap) + (space.y + space.height - probe.rest),
  );
  const region = { ...space, y: space.y + (space.height - height) / 2, height };
  const scale = balance("balance", { region, size, rows });
  const { rest, above } = scale;

  const tiles: Block[] = Array.from({ length: p.a }, (_, i) => ({
    id: `balance.x${i}`,
    role: "given",
    label: [{ sym: "x" }],
    width: tile,
  }));
  const across = Math.min(columns, p.a);
  const tilesW = across * tile + (across - 1) * gap;
  const groupW = tilesW + gap * 2 + onesW;
  const groupLeft = scale.left - groupW / 2;
  const tilePile = pile(tiles, groupLeft + tilesW / 2, rest, columns, tile, gap, size);
  const ones = pile(
    [{ id: "balance.ones", role: "given", label: formatNumber(p.b), width: onesW }],
    groupLeft + tilesW + gap * 2 + onesW / 2,
    rest,
    1,
    tile,
    gap,
    size,
  );
  const total = pile(
    [{ id: "balance.total", role: "given", label: formatNumber(p.c), width: totalW }],
    scale.right,
    rest,
    1,
    tile,
    gap,
    size,
  );

  // Taking the constant from both sides: the right total becomes what the x tiles weigh.
  const remainder = pile(
    [{ id: "subtract.block", role: "correct", label: formatNumber(p.c - p.b), width: remainderW }],
    scale.right,
    rest,
    1,
    tile,
    gap,
    size,
  );
  const take = `${sign === "+" ? "−" : "+"} ${constant}`;
  const opLabel = (id: string, words: string, x: number) =>
    text(id, "correct", words, x, above, { size, valign: "bottom" });

  // Sharing each side into a equal groups: one share for each x.
  const shares: Block[] = Array.from({ length: p.a }, (_, i) => ({
    id: `divide.share${i}`,
    role: "correct",
    label: formatNumber(p.x),
    width: shareW,
  }));
  const sharePile = pile(shares, scale.right, rest, columns, tile, gap, size);
  const ringAround = (id: string, box: Rect): SceneElement => ({
    id,
    role: "correct",
    type: "mark",
    kind: "ring",
    x: box.x - gap * 1.5,
    y: box.y - gap * 1.5,
    w: box.width + gap * 3,
    h: box.height + gap * 3,
  });

  return [
    ...scale.elements,
    ...tilePile.elements,
    ...ones.elements,
    ...total.elements,
    ...remainder.elements,
    opLabel("subtract.left", take, groupLeft + groupW / 2),
    opLabel("subtract.right", take, scale.right),
    ...sharePile.elements,
    opLabel("divide.left", `÷ ${p.a}`, groupLeft + tilesW / 2),
    opLabel("divide.right", `÷ ${p.a}`, scale.right),
    ringAround("divide.ringLeft", tilePile.boxes[0] as Rect),
    ringAround("divide.ringRight", sharePile.boxes[0] as Rect),
  ];
}

export const twoStepEquation: SceneTemplate<Params> = {
  key: "balance.two_step",
  version: 1,
  primitive: "balance",
  node: "A17",
  misconception: "EQ_DIVIDE_ONE_TERM",
  itemTemplate: "a17-two-step",
  title: "Do the same to the whole of each side",
  focusIds: ["question", "student", "balance", "slip", "subtract", "divide"],
  beatKinds: withRefocusKinds(
    "show_given",
    "show_student_working",
    "highlight_slip",
    "build",
    "transform",
    "reveal_correct",
  ),

  params(item) {
    const a = integer(item, "a", 2, 9);
    const b = integer(item, "b", -12, 15);
    const x = integer(item, "x", -6, 12);
    const c = integer(item, "c", -66, 123);
    if (b === 0) throw new Error("The constant term must not be zero");
    if (c !== a * x + b) throw new Error("c must equal a times x plus b");
    return { a, b, c, x };
  },

  spec(p, item, studentAnswer) {
    const [sign, constant] = signed(p.b);
    const remainder = formatNumber(p.c - p.b);
    return {
      schema: "scene-spec/1",
      template: "balance.two_step@1",
      misconception: "EQ_DIVIDE_ONE_TERM",
      params: item,
      studentAnswer,
      correctAnswer: p.x,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Solve ${equation(p)}. That means finding the value of x.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You wrote x ${sign} ${constant} = ${writtenWords(p.c, p.a)}, and then x = ${fractionWords(p.c - p.a * p.b, p.a)}.`,
        },
        {
          kind: "build",
          focus: ["balance"],
          narration: usesScales(p)
            ? `Think of the equation as a balance: ${p.a}x ${sign} ${constant} on one side, ${formatNumber(p.c)} on the other.`
            : `Set the equation out in two columns: ${p.a}x ${sign} ${constant} on the left side, ${formatNumber(p.c)} on the right side.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip is dividing only some terms. You divided ${p.a}x and ${formatNumber(p.c)} by ${p.a}, but not the ${formatNumber(p.b)}.`,
        },
        {
          kind: "transform",
          focus: ["subtract"],
          narration: `Undo the ${sign} ${constant} first, so there is only one term to divide. ${
            p.b > 0 ? `Take ${constant} from` : `Add ${constant} to`
          } each side: ${p.a}x ${usesScales(p) ? "balances" : "="} ${remainder}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["divide"],
          narration: usesScales(p)
            ? `Now divide the whole of each side by ${p.a}. One x balances ${formatNumber(p.x)}, so x = ${formatNumber(p.x)}.`
            : `Now divide the whole of each side by ${p.a}. That gives x = ${formatNumber(p.x)}.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    return layout(p, format).filter((element) => {
      const gone = UNTIL.find(
        ([prefix]) => element.id === prefix || element.id.startsWith(`${prefix}.`),
      );
      return revealed.has(focusOf(element.id)) && !(gone && revealed.has(gone[1]));
    });
  },

  predicted(p) {
    // x + b = c / a, so x = c / a − b.
    return fractionJson(p.c - p.a * p.b, p.a);
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Add", ["Multiply", p.a, p.x], p.b], p.c],
      // Taking b from each side (adding its size when b is negative) leaves nothing beside the x term.
      ["Equal", ["Add", p.b, -p.b], 0],
      ["Equal", ["Subtract", p.c, p.b], p.c - p.b],
      ["Equal", ["Divide", p.c - p.b, p.a], p.x],
      ["Equal", ["Divide", p.c, p.a], fractionJson(p.c, p.a)],
      ["Equal", ["Subtract", ["Divide", p.c, p.a], p.b], fractionJson(p.c - p.a * p.b, p.a)],
    ];
  },

  sample: { item: { a: 2, b: 11, c: 31, x: 10 }, studentAnswer: ["Rational", 9, 2] },
};
