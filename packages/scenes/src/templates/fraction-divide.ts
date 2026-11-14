import type { JsonValue } from "@eddy/schemas";
import { CANVAS, safeArea, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, bounds, stack, text } from "../layout/geometry";
import type { MathNode, Role, SceneElement, TextElement } from "../layout/types";
import { bar, brace, braceHeight } from "../primitives/bar-model";
import { gcd, integer, LABEL, memoise, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** FRAC_DIV_FLIP_FIRST: "2/3 ÷ 4/5 = 3/2 × 4/5", flipping the first fraction, not the divisor. */

interface Fraction {
  top: number;
  bottom: number;
}

interface Params {
  /** The question: first ÷ divisor, both proper and in lowest terms. */
  first: Fraction;
  divisor: Fraction;
  /** The first fraction upside down, as the student wrote it (it may be over 1). */
  flipped: Fraction;
  /** The divisor upside down, as written when you flip it, and its value in lowest terms. */
  reciprocal: Fraction;
  /** The student's answer, flipped first times divisor, in lowest terms. */
  wrong: Fraction;
  /** first × reciprocal before and after simplifying. */
  product: Fraction;
  answer: Fraction;
}

const FOCUS = ["question", "student", "slip", "bar", "flip", "answer"] as const;

const DENOMINATORS: Record<number, string> = {
  2: "halves",
  3: "thirds",
  4: "quarters",
  5: "fifths",
  6: "sixths",
  7: "sevenths",
  8: "eighths",
  9: "ninths",
};

function simplest(top: number, bottom: number): Fraction {
  const divisor = gcd(top, bottom);
  return { top: top / divisor, bottom: bottom / divisor };
}

/** A fraction as a maths label; a whole number as itself. */
const value = ({ top, bottom }: Fraction): MathNode =>
  bottom === 1 ? { num: String(top) } : written({ top, bottom });
/** A fraction as written, even over 1 ("5/1" when you flip 1/5). */
const written = ({ top, bottom }: Fraction): MathNode => ({
  frac: [[{ num: String(top) }], [{ num: String(bottom) }]],
});
const words = ({ top, bottom }: Fraction): string => (bottom === 1 ? `${top}` : `${top}/${bottom}`);
const writtenWords = ({ top, bottom }: Fraction): string => `${top}/${bottom}`;
const rational = ({ top, bottom }: Fraction): JsonValue => ["Rational", top, bottom];
const simplifies = (p: Params): boolean => p.product.bottom !== p.answer.bottom;
/** wrong ≤ first: then the size check shows the slip (dividing by less than 1 makes it bigger). */
const notBigger = (p: Params): boolean =>
  p.wrong.top * p.first.bottom <= p.first.top * p.wrong.bottom;

/** Space between neighbouring pieces of working: each piece's box already has its own margin. */
const GAP = WORKING * 0.2;
/** Space between lines of working. */
const LINE_GAP = WORKING * 0.3;
/** Space between the parts of the scene: less on a phone, where the column is tall. */
const PART_GAP = { desktop: WORKING * 0.45, mobile: WORKING * 0.25 } as const;

interface Piece {
  id: string;
  content: string | MathNode[];
}

/**
 * Pieces of working side by side from `left`, centred on `centreY`, each its own label, so a pen
 * mark can go round one of them and a later line can line up under one of them.
 */
function row(pieces: Piece[], role: Role, left: number, centreY: number): TextElement[] {
  const out: TextElement[] = [];
  let x = left;
  for (const piece of pieces) {
    // Centred in its own box, so a lone operator has an even space either side of it.
    const label = {
      ...text(piece.id, role, piece.content, 0, centreY, { size: WORKING, align: "middle" }),
      x,
    };
    out.push(label);
    x = label.x + label.w + GAP;
  }
  return out;
}

/** The height of a line of working with a fraction in it. */
const ROW_HEIGHT = text("row", "given", [written({ top: 1, bottom: 2 })], 0, 0, {
  size: WORKING,
}).h;

/** A pen ring round a label, clear of a fraction's corners. */
function ring(id: string, role: "misconception" | "correct", label: TextElement): SceneElement {
  const box = bounds(label);
  return {
    id,
    role,
    type: "mark",
    kind: "ring",
    x: box.x - WORKING * 0.12,
    y: box.y - WORKING * 0.2,
    w: box.width + WORKING * 0.24,
    h: box.height + WORKING * 0.4,
  };
}

/** Every element the scene can show, in drawing order: positions never shift between beats. */
function computeParts(p: Params, format: SceneFormat): SceneElement[] {
  const safe = safeArea(CANVAS[format].width, CANVAS[format].height);
  // Desktop: two columns, the question and the bar on the left, the slip and the working on the
  // right. Mobile: one column.
  const column = format === "desktop" ? (safe.width - WORKING * 1.5) / 2 : safe.width;
  const left: Rect = { ...safe, width: column };
  const right: Rect =
    format === "desktop" ? { ...safe, x: safe.x + safe.width - column, width: column } : left;
  const partGap = PART_GAP[format];
  const out: SceneElement[] = [];

  // The question: what to do, then the division under it.
  const ask = text("question.ask", "given", "Work out, in simplest form:", left.x, safe.y, {
    size: WORKING,
    align: "start",
    valign: "top",
  });
  const sum = text(
    "question.sum",
    "given",
    [written(p.first), { op: "÷" }, written(p.divisor)],
    left.x,
    // A fraction reaches a little above its box: leave room under the words.
    ask.y + ask.h + WORKING * 0.22 + ROW_HEIGHT / 2,
    { size: WORKING, align: "start" },
  );
  out.push(ask, sum);

  // The student's working: the first fraction flipped, then multiplied by the divisor.
  const studentTop = bottomOf([ask, sum]) + LINE_GAP;
  const student = row(
    [
      { id: "student.first", content: [written(p.first)] },
      { id: "student.divide", content: [{ op: "÷" }] },
      { id: "student.dividedBy", content: [written(p.divisor)] },
      { id: "student.equals", content: [{ op: "=" }] },
      { id: "student.flipped", content: [written(p.flipped)] },
      { id: "student.times", content: [{ op: "×" }] },
      { id: "student.divisor", content: [written(p.divisor)] },
      { id: "student.result.equals", content: [{ op: "=" }] },
      { id: "student.result", content: [value(p.wrong)] },
    ],
    "student",
    left.x,
    studentTop + ROW_HEIGHT / 2,
  );
  out.push(...student);

  // The slip, named and marked, with a ring round the fraction that was flipped.
  const slipTop = format === "desktop" ? safe.y : bottomOf(student) + partGap;
  const slip = stack(
    [
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      { id: "slip.reasoning", role: "misconception", content: "flipping the first fraction" },
    ],
    { ...right, y: slipTop },
    { size: WORKING, spacing: WORKING * 0.22 },
  );
  const reasoning = bounds(slip[1]!);
  out.push(...slip, {
    id: "slip.mark",
    role: "misconception",
    type: "mark",
    kind: "cross",
    x: reasoning.x + reasoning.width + WORKING * 0.3,
    y: reasoning.y + reasoning.height * 0.15,
    w: WORKING * 0.7,
    h: reasoning.height * 0.7,
  });
  out.push(
    ring(
      "slip.ring",
      "misconception",
      student.find((e) => e.id === "student.flipped")!,
    ),
  );

  // The bar: one whole in d equal parts, with the divisor's c parts shaded and braced below.
  // On desktop the bar and the working sit in the middle of the space under the top half.
  const barHeight = format === "desktop" ? LABEL * 1.6 : LABEL * 1.1;
  const blockHeight =
    braceHeight(LABEL, "1") + barHeight + braceHeight(LABEL, [written(p.divisor)]);
  const below = Math.max(bottomOf(student), bottomOf(slip)) + partGap;
  const lower =
    format === "desktop"
      ? below + Math.max(0, (safe.y + safe.height - below - blockHeight) / 2)
      : bottomOf(slip) + partGap;
  const partsWide = Math.round(left.width * 0.55);
  const barTop = lower + braceHeight(LABEL, "1");
  const model = bar({
    id: "bar",
    x: left.x,
    y: barTop,
    parts: p.divisor.bottom,
    partWidth: partsWide / p.divisor.bottom,
    height: barHeight,
    role: "structure",
  });
  const shaded = model.elements.map((element, i) =>
    i < p.divisor.top ? { ...element, fill: true } : element,
  );
  const within: Rect = { ...left, y: lower, height: safe.y + safe.height - lower };
  const whole = brace({
    id: "bar.whole",
    role: "given",
    span: model.box,
    side: "above",
    label: "1",
    size: LABEL,
    within,
  });
  const part = brace({
    id: "bar.divisor",
    role: "given",
    span: model.span(0, p.divisor.top),
    side: "below",
    label: [written(p.divisor)],
    size: LABEL,
    within,
  });
  // How many of the divisor make one whole: beside the bar.
  const reciprocal = text(
    "bar.reciprocal",
    "correct",
    [{ num: "1" }, { op: "÷" }, written(p.divisor), { op: "=" }, value(p.reciprocal)],
    model.box.x + model.box.width + WORKING * 0.8,
    model.box.y + model.box.height / 2,
    { size: WORKING, align: "start" },
  );
  out.push(...shaded, ...whole.elements, ...part.elements, reciprocal);

  // Keep, change, flip: on desktop beside the bar, on mobile under it.
  const flipTop = format === "desktop" ? lower : bottomOf([...part.elements]) + partGap;
  const flip = row(
    [
      { id: "flip.first", content: [written(p.first)] },
      { id: "flip.divide", content: [{ op: "÷" }] },
      { id: "flip.divisor", content: [written(p.divisor)] },
      { id: "flip.equals", content: [{ op: "=" }] },
      { id: "flip.keep", content: [written(p.first)] },
      { id: "flip.times", content: [{ op: "×" }] },
      { id: "flip.reciprocal", content: [written(p.reciprocal)] },
    ],
    "correct",
    right.x,
    flipTop + ROW_HEIGHT / 2,
  );
  // The divisor flipped, ringed: the right fraction to turn over.
  const flippedLabel = flip.find((e) => e.id === "flip.reciprocal")!;
  const flipped = bounds(flippedLabel);
  out.push(...flip, ring("flip.ring", "correct", flippedLabel));

  // Multiply and simplify. Desktop: a second line, its "=" under the first one. Mobile: the
  // same line carries on.
  const equals = flip.find((e) => e.id === "flip.equals")!;
  const [answerLeft, answerCentre] =
    format === "desktop"
      ? [equals.x, flipTop + ROW_HEIGHT * 1.5 + LINE_GAP + WORKING * 0.5]
      : [flipped.x + flipped.width + GAP, flipTop + ROW_HEIGHT / 2];
  const pieces: Piece[] = [
    { id: "answer.equals", content: [{ op: "=" }] },
    { id: "answer.product", content: [written(p.product)] },
  ];
  if (simplifies(p)) {
    pieces.push(
      { id: "answer.simplified.equals", content: [{ op: "=" }] },
      { id: "answer.value", content: [value(p.answer)] },
    );
  }
  const answer = row(pieces, "correct", answerLeft, answerCentre);
  out.push(...answer, ring("answer.ring", "correct", answer[answer.length - 1]!));
  return out;
}

/** The geometry is the same for every beat: work it out once per scene and format. */
const partsCache = memoise((key) => {
  const [p, format] = JSON.parse(key) as Parameters<typeof computeParts>;
  return computeParts(p, format);
});
function parts(p: Params, format: SceneFormat): SceneElement[] {
  return partsCache(JSON.stringify([p, format]));
}

export const fractionDivide: SceneTemplate<Params> = {
  key: "bar_model.fraction_divide",
  version: 1,
  primitive: "bar_model",
  node: "N2",
  misconception: "FRAC_DIV_FLIP_FIRST",
  itemTemplate: "n2-fraction-divide",
  title: "Dividing by a fraction",
  focusIds: FOCUS,
  beatKinds: withRefocusKinds(
    "show_given",
    "show_student_working",
    "highlight_slip",
    "build",
    "transform",
    "reveal_correct",
  ),

  params(item) {
    const a = integer(item, "a", 1, 8);
    const b = integer(item, "b", 2, 9);
    const c = integer(item, "c", 1, 8);
    const d = integer(item, "d", 2, 9);
    if (a >= b || c >= d) throw new Error("Both fractions must be proper");
    if (gcd(a, b) !== 1 || gcd(c, d) !== 1)
      throw new Error("Both fractions must be in lowest terms");
    if ((a * d) % (b * c) === 0) throw new Error("The answer must not be a whole number");
    return {
      first: { top: a, bottom: b },
      divisor: { top: c, bottom: d },
      flipped: { top: b, bottom: a },
      reciprocal: { top: d, bottom: c },
      wrong: simplest(b * c, a * d),
      product: { top: a * d, bottom: b * c },
      answer: simplest(a * d, b * c),
    };
  },

  spec(p, item, studentAnswer) {
    const [first, divisor, wrong, product, answer] = [
      p.first,
      p.divisor,
      p.wrong,
      p.product,
      p.answer,
    ].map(words);
    const [flipped, reciprocal] = [p.flipped, p.reciprocal].map(writtenWords);
    // The divisor's parts by name: "fifths" for 4/5.
    const pieces = DENOMINATORS[p.divisor.bottom];
    return {
      schema: "scene-spec/1",
      template: "bar_model.fraction_divide@1",
      misconception: "FRAC_DIV_FLIP_FIRST",
      params: item,
      studentAnswer,
      correctAnswer: rational(p.answer),
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Work out ${first} divided by ${divisor}. Give your answer as a fraction in its simplest form.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You turned ${first} upside down to get ${flipped}, then multiplied by ${divisor} to get ${wrong}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: notBigger(p)
            ? `A common slip: flipping the first fraction. Dividing by ${divisor}, less than 1, should give more than ${first}. Your answer, ${wrong}, is not more.`
            : `A common slip: flipping the first fraction. Leave ${first} as it is. The fraction to flip is ${divisor}, the one you divide by.`,
        },
        {
          kind: "build",
          focus: ["bar"],
          // With one part in a group the groups fit a whole number of times; otherwise the count
          // is the number of parts divided by the parts in a group, as the label beside the bar.
          narration:
            p.divisor.top === 1
              ? `One whole is ${p.divisor.bottom} ${pieces}, so ${p.divisor.bottom} lots of ${divisor} fit into 1.`
              : `One whole is ${p.divisor.bottom} ${pieces}. Groups of ${p.divisor.top} ${pieces} fit into it ${p.divisor.bottom} divided by ${p.divisor.top} times: that is ${reciprocal} times.`,
        },
        {
          kind: "transform",
          focus: ["flip"],
          narration: `So dividing by ${divisor} is multiplying by ${words(p.reciprocal)}. Keep ${first}, change divide to multiply, and flip the second fraction.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: simplifies(p)
            ? `Multiply the numerators, then the denominators: ${product}. That simplifies to ${answer}, so ${first} divided by ${divisor} is ${answer}.`
            : `Multiply the numerators, then the denominators: ${answer}. That is in its simplest form, so ${first} divided by ${divisor} is ${answer}.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    return parts(p, format).filter((element) => {
      const focus = FOCUS.find((id) => element.id === id || element.id.startsWith(`${id}.`));
      return focus !== undefined && revealed.has(focus);
    });
  },

  predicted(p) {
    // The first fraction flipped, times the divisor.
    return rational(p.wrong);
  },

  claims(p): JsonValue[] {
    const [first, divisor] = [rational(p.first), rational(p.divisor)];
    const reciprocal = rational(p.reciprocal);
    const claims: JsonValue[] = [
      ["Equal", ["Multiply", rational(p.flipped), divisor], rational(p.wrong)],
      ["Less", divisor, 1],
      ["Equal", ["Multiply", reciprocal, divisor], 1],
      ["Equal", ["Divide", 1, divisor], reciprocal],
      // Groups of c parts fit into d parts d ÷ c times.
      ["Equal", ["Divide", p.divisor.bottom, p.divisor.top], reciprocal],
      ["Equal", ["Divide", first, divisor], ["Multiply", first, reciprocal]],
      ["Equal", ["Multiply", first, reciprocal], rational(p.product)],
      ["Equal", rational(p.product), rational(p.answer)],
      ["Greater", rational(p.answer), first],
    ];
    if (notBigger(p)) claims.push(["LessEqual", rational(p.wrong), first]);
    return claims;
  },

  sample: { item: { a: 5, b: 6, c: 2, d: 3 }, studentAnswer: ["Rational", 4, 5] },
};
