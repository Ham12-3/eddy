import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, markBeside, stack, text } from "../layout/geometry";
import { measureMaths } from "../layout/measure";
import type { MathNode, SceneElement, TextElement } from "../layout/types";
import { bar } from "../primitives/bar-model";
import { gcd, integer, LABEL, layoutFor, memoise, withRefocusKinds, WORKING } from "./shared";
import type { ItemParams, SceneTemplate } from "./template";

/** FRAC_ADD_NUM_DEN: "1/2 + 1/3 = 2/5: add the tops, add the bottoms." */

interface Fraction {
  top: number;
  bottom: number;
}

interface Params {
  /** The two fractions as the question gives them, both in lowest terms. */
  first: Fraction;
  second: Fraction;
  /** The student's sum, (a + c)/(b + d), as worked, and in lowest terms. */
  slip: Fraction;
  slipSimplest: Fraction;
  /** The larger of the two fractions: the student's sum is less than it. */
  larger: Fraction;
  /** The lowest common denominator, each fraction over it, and their sum over it. */
  common: number;
  firstOver: Fraction;
  secondOver: Fraction;
  total: Fraction;
  answer: Fraction;
}

const FOCUS = ["question", "student", "slip", "bars", "common", "answer"] as const;

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.48, h: 0.4 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.4 },
    all: { x: 0, y: 0, w: 1, h: 1 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    all: { x: 0, y: 0, w: 1, h: 1 },
  },
});

function simplest(top: number, bottom: number): Fraction {
  const divisor = gcd(top, bottom);
  return { top: top / divisor, bottom: bottom / divisor };
}

const num = (value: number): MathNode => ({ num: String(value) });
const frac = ({ top, bottom }: Fraction): MathNode => ({ frac: [[num(top)], [num(bottom)]] });
const words = ({ top, bottom }: Fraction): string => `${top}/${bottom}`;
const rational = ({ top, bottom }: Fraction): JsonValue => ["Rational", top, bottom];
const same = (x: Fraction, y: Fraction): boolean => x.top === y.top && x.bottom === y.bottom;
const slipSimplifies = (p: Params): boolean => !same(p.slip, p.slipSimplest);
const totalSimplifies = (p: Params): boolean => !same(p.total, p.answer);

/** The bars' rows: a fraction's bar, labelled with the fraction, and later its equivalent. */
interface Row {
  key: "first" | "second";
  fraction: Fraction;
  over: Fraction;
}

/** Every element the scene can show, in drawing order. Positions never depend on the beat. */
function computeParts(p: Params, format: SceneFormat): SceneElement[] {
  const regions = REGIONS[format];
  const size = WORKING;
  const gap = size * 0.22;
  const textRegion = regionRect(format, regions.text);
  const all = regionRect(format, regions.all);

  // The question, with the student's answer completing its sum on the same line.
  const prompt = stack(
    [{ id: "question.prompt", role: "given", content: "Work out, in simplest form:" }],
    textRegion,
    { size },
  );
  const sum = text(
    "question.sum",
    "given",
    [frac(p.first), { op: "+" }, frac(p.second)],
    textRegion.x,
    bottomOf(prompt) + gap,
    { size, align: "start", valign: "top" },
  );
  const student = text(
    "student.answer",
    "student",
    [{ op: "=" }, frac(p.slip), ...(slipSimplifies(p) ? [{ op: "=" }, frac(p.slipSimplest)] : [])],
    sum.x + sum.w + 1,
    sum.y + sum.h / 2,
    { size, align: "start" },
  );

  // The slip: the tops added and the bottoms added, crossed out, and why it cannot be right.
  const notes: Rect =
    format === "desktop"
      ? regionRect(format, regions.notes)
      : { ...textRegion, y: bottomOf([sum, student]) + size * 0.35 };
  // The title and the faulty working share a line, the cross right after the working; the size
  // comparison has a line of its own, so the cross never reads as a times sign.
  const { top: a, bottom: b } = p.first;
  const { top: c, bottom: d } = p.second;
  const sums = text(
    "slip.working",
    "misconception",
    [
      {
        frac: [
          [num(a), { op: "+" }, num(c)],
          [num(b), { op: "+" }, num(d)],
        ],
      },
    ],
    0,
    notes.y,
    { size, align: "start", valign: "top" },
  );
  // A sum in the numerator and the denominator draws a little taller than a plain fraction
  // (the keyframe checker measured it): its box gets the room. The glyphs are centred in it.
  const middle = notes.y + (sums.h + size * 0.2) / 2;
  const title = text("slip.title", "misconception", "A common slip:", notes.x, middle, {
    size,
    font: "pen",
    align: "start",
  });
  const working: TextElement = {
    ...sums,
    x: title.x + title.w + size * 0.3,
    h: sums.h + size * 0.2,
  };
  // The pen cross right after the working. markBeside's cross takes most of the line's height,
  // which on a fraction stretches it into a thin X; this one keeps a pen cross's shape.
  const beside = markBeside("slip.mark", "misconception", "cross", working, size);
  const cross: SceneElement = {
    ...beside,
    w: size * 0.9,
    h: size * 1.2,
    y: working.y + (working.h - size * 1.2) / 2,
  } as SceneElement;
  const check = text(
    "slip.check",
    "given",
    [frac(p.slip), { op: "<" }, frac(p.larger)],
    notes.x,
    working.y + working.h + gap,
    { size, align: "start", valign: "top" },
  );

  // The bars: one row for each fraction, then the sum, then the working under it.
  const rows: Row[] = [
    { key: "first", fraction: p.first, over: p.firstOver },
    { key: "second", fraction: p.second, over: p.secondOver },
  ];
  const leftW = Math.max(...rows.map((row) => measureMaths([frac(row.fraction)], LABEL).w));
  const rightW = Math.max(
    ...rows.map((row) => measureMaths([{ op: "=" }, frac(row.over)], LABEL).w),
  );
  const pad = LABEL * 0.4;
  const barX = all.x + leftW + pad;
  const barW = all.width - leftW - rightW - 2 * pad;
  const rowH = measureMaths([frac(p.first)], LABEL).h;
  // Mobile bars and gaps are a little shorter, so the whole scene fits the 4:5 column.
  const barH = format === "desktop" ? LABEL * 2 : LABEL * 1.5;
  const rowGap = LABEL * 0.35;
  const answerGap = format === "desktop" ? size * 0.5 : size * 0.4;
  const answerH = measureMaths([frac(p.total)], size).h;
  const block = 2 * rowH + barH + answerH + 2 * rowGap + answerGap;
  const above = Math.max(bottomOf([sum, student]), bottomOf([title, working, check]));
  const start = above + (format === "desktop" ? size * 0.6 : size * 0.4);
  // On desktop the bars sit in the middle of the space left; on mobile they follow the slip.
  const blockTop =
    format === "desktop" ? start + Math.max(0, (all.y + all.height - start - block) / 2) : start;

  // Narrow pieces are cut with ticks down from the top edge, like a ruler: full-height cuts that
  // close together would hide which parts are shaded.
  const part = barW / p.common;
  const cutDepth = part < LABEL * 0.6 ? barH * 0.4 : barH;
  const cutLine = (id: string, k: number, y: number): SceneElement => ({
    id,
    role: "structure",
    type: "line",
    x1: barX + k * part,
    y1: y,
    x2: barX + k * part,
    y2: y + cutDepth,
    width: 2,
  });

  const bars: SceneElement[] = [];
  const common: SceneElement[] = [];
  rows.forEach((row, index) => {
    const rowY = blockTop + index * (rowH + rowGap);
    const barY = rowY + (rowH - barH) / 2;
    const model = bar({
      id: `bars.${row.key}`,
      x: barX,
      y: barY,
      parts: row.fraction.bottom,
      partWidth: barW / row.fraction.bottom,
      height: barH,
      role: "given",
    });
    bars.push(
      ...model.elements.map((element, i) =>
        i < row.fraction.top ? { ...element, fill: true } : element,
      ),
      text(`bars.${row.key}.label`, "given", [frac(row.fraction)], barX - pad, rowY + rowH / 2, {
        size: LABEL,
        align: "end",
      }),
    );
    // Each part cut into equal pieces of the common denominator.
    const pieces = p.common / row.fraction.bottom;
    for (let k = 1; k < p.common; k += 1) {
      if (k % pieces !== 0) common.push(cutLine(`common.${row.key}.cut.${k}`, k, barY));
    }
    common.push(
      text(
        `common.${row.key}.value`,
        "correct",
        [{ op: "=" }, frac(row.over)],
        barX + barW + pad,
        rowY + rowH / 2,
        { size: LABEL, align: "start" },
      ),
    );
  });

  // The sum: the shaded pieces put together in one bar of the common denominator.
  const sumY = blockTop + 2 * (rowH + rowGap);
  const shadedW = p.total.top * part;
  const answer: SceneElement[] = [
    {
      id: "answer.bar.shaded",
      role: "correct",
      type: "rect",
      x: barX,
      y: sumY,
      w: shadedW,
      h: barH,
      fill: true,
    },
    {
      id: "answer.bar.rest",
      role: "correct",
      type: "rect",
      x: barX + shadedW,
      y: sumY,
      w: barW - shadedW,
      h: barH,
    },
  ];
  for (let k = 1; k < p.common; k += 1) {
    if (k !== p.total.top) answer.push(cutLine(`answer.cut.${k}`, k, sumY));
  }

  // The working: each piece its own label, side by side, so the ring goes round a whole label.
  // Each piece is centred in its box, so the measuring slack is split either side of it and the
  // spaces round each "=" come out even. The ringed fraction stands a little apart for its ring.
  const centreY = sumY + barH + answerGap + answerH / 2;
  const after = (id: string, content: MathNode[], left: number): TextElement => ({
    ...text(id, "correct", content, 0, centreY, { size, align: "middle" }),
    x: left,
  });
  const ringRoom = size * 0.2;
  const simplifies = totalSimplifies(p);
  const added = after("answer.working", [frac(p.firstOver), { op: "+" }, frac(p.secondOver)], barX);
  const equals = after("answer.equals", [{ op: "=" }], added.x + added.w + 1);
  const total = after(
    "answer.total",
    [frac(p.total)],
    equals.x + equals.w + (simplifies ? 1 : ringRoom),
  );
  answer.push(added, equals, total);
  let final = total;
  if (simplifies) {
    const again = after("answer.simplest.equals", [{ op: "=" }], total.x + total.w + 1);
    final = after("answer.simplest", [frac(p.answer)], again.x + again.w + ringRoom);
    answer.push(again, final);
  }
  answer.push({
    id: "answer.ring",
    role: "correct",
    type: "mark",
    kind: "ring",
    x: final.x - size * 0.12,
    y: final.y - size * 0.22,
    w: final.w + size * 0.24,
    h: final.h + size * 0.44,
  });

  return [...prompt, sum, student, title, working, cross, check, ...bars, ...common, ...answer];
}

/** The geometry is the same for every beat: work it out once per scene and format. */
const partsCache = memoise((key) => {
  const [p, format] = JSON.parse(key) as Parameters<typeof computeParts>;
  return computeParts(p, format);
});
function parts(p: Params, format: SceneFormat): SceneElement[] {
  return partsCache(JSON.stringify([p, format]));
}

/**
 * The most parts a bar is cut into. Beyond this (56, 63 or 72 parts) the pieces are too thin to
 * read on a 288 px phone, so the scene declines the item and the tutor explains it in writing.
 */
const MAX_COMMON = 24;

/** A fraction of the item: proper, in lowest terms, with a denominator from 2 to 9. */
function proper(item: ItemParams, top: string, bottom: string): Fraction {
  const denominator = integer(item, bottom, 2, 9);
  const numerator = integer(item, top, 1, denominator - 1);
  if (gcd(numerator, denominator) !== 1) {
    throw new Error(`${top}/${bottom} must be in lowest terms`);
  }
  return { top: numerator, bottom: denominator };
}

export const fractionAdd: SceneTemplate<Params> = {
  key: "bar_model.fraction_add",
  version: 1,
  primitive: "bar_model",
  node: "N2",
  misconception: "FRAC_ADD_NUM_DEN",
  itemTemplate: "n2-fraction-add-unlike",
  title: "Adding fractions with different denominators",
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
    const first = proper(item, "a", "b");
    const second = proper(item, "c", "d");
    if (first.bottom === second.bottom) throw new Error("The denominators must differ");
    const common = (first.bottom * second.bottom) / gcd(first.bottom, second.bottom);
    if (common > MAX_COMMON) {
      throw new Error(
        `The lowest common denominator is ${common}: bars cut into more than ${MAX_COMMON} parts cannot be read on a phone, so this item gets a written explanation`,
      );
    }
    const firstOver = { top: (first.top * common) / first.bottom, bottom: common };
    const secondOver = { top: (second.top * common) / second.bottom, bottom: common };
    const total = { top: firstOver.top + secondOver.top, bottom: common };
    if (total.top >= common) throw new Error("The sum must be less than 1");
    const slip = { top: first.top + second.top, bottom: first.bottom + second.bottom };
    const firstLarger = first.top * second.bottom > second.top * first.bottom;
    return {
      first,
      second,
      slip,
      slipSimplest: simplest(slip.top, slip.bottom),
      larger: firstLarger ? first : second,
      common,
      firstOver,
      secondOver,
      total,
      answer: simplest(total.top, total.bottom),
    };
  },

  spec(p, item, studentAnswer) {
    const [first, second, slip, simplestSlip, total, answer] = [
      p.first,
      p.second,
      p.slip,
      p.slipSimplest,
      p.total,
      p.answer,
    ].map(words);
    const larger = words(p.larger);
    const smaller = same(p.larger, p.first) ? second : first;
    const becomes = (from: Fraction, to: Fraction) =>
      same(from, to) ? `${words(from)} stays ${words(to)}` : `${words(from)} is ${words(to)}`;
    return {
      schema: "scene-spec/1",
      template: "bar_model.fraction_add@1",
      misconception: "FRAC_ADD_NUM_DEN",
      params: item,
      studentAnswer,
      correctAnswer: rational(p.answer),
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Work out ${first} plus ${second}. Give your answer as a fraction in its simplest form.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: slipSimplifies(p)
            ? `You added the numerators and added the denominators: ${first} plus ${second} gave ${slip}, which is ${simplestSlip}.`
            : `You added the numerators and added the denominators: ${first} plus ${second} gave ${slip}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: adding numerators and adding denominators. ${slip} is less than ${larger}, but adding ${smaller} to ${larger} must give more than ${larger}.`,
        },
        {
          kind: "build",
          focus: ["bars"],
          narration:
            "Here are both fractions on bars the same length. The pieces are different sizes, so you cannot add the numerators yet.",
        },
        {
          kind: "transform",
          focus: ["common"],
          narration: `Use a common denominator, ${p.common}: cut both bars into ${p.common} equal parts. So ${becomes(p.first, p.firstOver)}, and ${becomes(p.second, p.secondOver)}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: totalSimplifies(p)
            ? `Now the pieces match: add the numerators, keep the denominator. ${words(p.firstOver)} plus ${words(p.secondOver)} is ${total}, which simplifies to ${answer}.`
            : `Now the pieces match: add the numerators and keep the denominator. ${words(p.firstOver)} plus ${words(p.secondOver)} is ${total}, already in its simplest form.`,
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
    // Adding the numerators and adding the denominators.
    return rational(p.slip);
  },

  claims(p): JsonValue[] {
    const [first, second] = [rational(p.first), rational(p.second)];
    const sum = ["Add", first, second];
    return [
      ["Equal", ["Add", p.first.top, p.second.top], p.slip.top],
      ["Equal", ["Add", p.first.bottom, p.second.bottom], p.slip.bottom],
      ["Equal", rational(p.slip), rational(p.slipSimplest)],
      ["Less", rational(p.slip), rational(p.larger)],
      ["Greater", sum, rational(p.larger)],
      ["Equal", ["Multiply", p.first.bottom, p.common / p.first.bottom], p.common],
      ["Equal", ["Multiply", p.second.bottom, p.common / p.second.bottom], p.common],
      ["Equal", first, rational(p.firstOver)],
      ["Equal", second, rational(p.secondOver)],
      ["Equal", ["Add", rational(p.firstOver), rational(p.secondOver)], rational(p.total)],
      ["Equal", rational(p.total), rational(p.answer)],
      ["Equal", sum, rational(p.answer)],
    ];
  },

  sample: { item: { a: 1, b: 2, c: 1, d: 3 }, studentAnswer: ["Rational", 2, 5] },
};
