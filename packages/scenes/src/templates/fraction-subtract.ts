import type { JsonValue } from "@eddy/schemas";
import { CANVAS, regionRect, safeArea, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, markBeside, stack, text } from "../layout/geometry";
import { measureMaths, measureText } from "../layout/measure";
import type { MathNode, Role, SceneElement, TextElement } from "../layout/types";
import { bar, brace, braceHeight, type Bar } from "../primitives/bar-model";
import { gcd, integer, LABEL, layoutFor, memoise, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** FRAC_SUB_NUM_DEN: "3/4 - 1/2 is (3 - 1)/(4 - 2), which is 2/2." */

const FOCUS = ["question", "student", "slip", "bar", "part", "answer"] as const;

interface Fraction {
  top: number;
  bottom: number;
}

interface Params {
  /** The fractions as the question gives them: first minus second. */
  first: Fraction;
  second: Fraction;
  /** The student's working: the numerators taken away over the denominators taken away. */
  slip: Fraction;
  /** The student's answer: the slip in lowest terms (a whole number when the bottom is 1). */
  student: Fraction;
  /** The lowest common denominator, and both fractions written over it. */
  common: number;
  firstOver: Fraction;
  secondOver: Fraction;
  /** The difference over the common denominator, and in its simplest form. */
  difference: Fraction;
  answer: Fraction;
}

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.46, h: 0.42 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.42 },
    bars: { x: 0, y: 0.46, w: 1, h: 0.54 },
  },
  // On a phone everything stacks in one column; the bars take what the text leaves.
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    bars: { x: 0, y: 0, w: 1, h: 1 },
  },
});

/** The pieces a denominator cuts a whole into, as the narration names them. */
const PIECES: Record<number, string> = {
  2: "halves",
  3: "thirds",
  4: "quarters",
  5: "fifths",
  6: "sixths",
  7: "sevenths",
  8: "eighths",
  9: "ninths",
};
const pieces = (denominator: number) => PIECES[denominator] as string;
const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

function simplest(top: number, bottom: number): Fraction {
  const divisor = gcd(top, bottom);
  return { top: top / divisor, bottom: bottom / divisor };
}

/** A fraction as a maths label; a whole number as itself. */
const frac = ({ top, bottom }: Fraction): MathNode =>
  bottom === 1
    ? { num: String(top) }
    : { frac: [[{ num: String(top) }], [{ num: String(bottom) }]] };
const words = ({ top, bottom }: Fraction): string => (bottom === 1 ? `${top}` : `${top}/${bottom}`);
const rational = ({ top, bottom }: Fraction): JsonValue => ["Rational", top, bottom];
const same = (a: Fraction, b: Fraction) => a.top === b.top && a.bottom === b.bottom;
/** Whether the student's answer is a whole one or more. */
const wholeOrMore = (p: Params) => p.student.top >= p.student.bottom;
const MINUS: MathNode = { op: "−" };
const EQUALS: MathNode = { op: "=" };

/** The student's working: "3/4 − 1/2 = 2/2", then "= 1" when that reduces. */
function studentWorking(p: Params): MathNode[] {
  const working = [frac(p.first), MINUS, frac(p.second), EQUALS, frac(p.slip)];
  return same(p.slip, p.student) ? working : [...working, EQUALS, frac(p.student)];
}

/** The corrected working: "9/12 − 8/12 = 1/12", then "= 1/3" when that simplifies. */
function correctWorking(p: Params): MathNode[] {
  const working = [frac(p.firstOver), MINUS, frac(p.secondOver), EQUALS, frac(p.difference)];
  return same(p.difference, p.answer) ? working : [...working, EQUALS, frac(p.answer)];
}

/**
 * The most common parts a bar is cut into. Beyond this (56, 63 or 72 parts) the pieces cannot be
 * told apart on a 288 px phone, so those items get a written explanation instead of a scene.
 */
const MAX_COMMON_DENOMINATOR = 24;

/** A thin cut down a bar at every common part that is not already a part edge. */
function cuts(id: string, model: Bar, p: Params, own: number): SceneElement[] {
  const step = model.box.width / p.common;
  const per = p.common / own;
  const { y, height } = model.box;
  const lines: SceneElement[] = [];
  for (let i = 1; i < p.common; i += 1) {
    if (i % per === 0) continue;
    const x = model.box.x + i * step;
    lines.push({
      id: `${id}.${lines.length}`,
      role: "structure",
      type: "line",
      x1: x,
      y1: y + 3,
      x2: x,
      y2: y + height - 3,
      width: 2,
    });
  }
  return lines;
}

/**
 * A few words, then maths, on one row from (x, top): the words in the scene font, the maths
 * beside them, both centred on the row.
 */
function sentence(
  id: string,
  role: Role,
  words: string,
  maths: MathNode[],
  x: number,
  top: number,
  size: number,
): TextElement[] {
  const centre = top + Math.max(measureText(words, size).h, measureMaths(maths, size).h) / 2;
  const lead = text(`${id}.words`, role, words, x, centre, { size, align: "start" });
  const sum = text(`${id}.maths`, role, maths, lead.x + lead.w + size * 0.1, centre, {
    size,
    align: "start",
  });
  return [lead, sum];
}

/** Every element, by focus id. Positions never depend on what is revealed, so nothing shifts. */
function computeLayout(p: Params, format: SceneFormat): Record<string, SceneElement[]> {
  // Phones set the working at the label size: the column has two bars to fit under it.
  const size = format === "desktop" ? WORKING : LABEL;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};

  out.question = sentence(
    "question",
    "given",
    "Work out",
    [frac(p.first), MINUS, frac(p.second)],
    textRegion.x,
    textRegion.y,
    size,
  );
  out.student = sentence(
    "student",
    "student",
    "You wrote",
    studentWorking(p),
    textRegion.x,
    bottomOf(out.question) + gap,
    size,
  );

  // The faulty step: the numerators taken away over the denominators taken away.
  const faulty: MathNode[] = [
    {
      frac: [
        [{ num: String(p.first.top) }, MINUS, { num: String(p.second.top) }],
        [{ num: String(p.first.bottom) }, MINUS, { num: String(p.second.bottom) }],
      ],
    },
    EQUALS,
    frac(p.slip),
  ];
  let slip: TextElement[];
  if (format === "desktop") {
    slip = stack(
      [
        { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
        { id: "slip.reasoning", role: "misconception", content: faulty },
      ],
      regionRect(format, regions.notes),
      { size, spacing: gap },
    );
  } else {
    // On a phone the title and the faulty step share one row, centred on each other.
    const top = bottomOf(out.student) + size * 0.5;
    const reasoningHeight = measureMaths(faulty, size).h;
    const centre = top + reasoningHeight / 2;
    const title = text("slip.title", "misconception", "A common slip:", textRegion.x, centre, {
      size,
      font: "pen",
      align: "start",
    });
    const reasoning = text(
      "slip.reasoning",
      "misconception",
      faulty,
      title.x + title.w + size * 0.5,
      centre,
      { size, align: "start" },
    );
    slip = [title, reasoning];
  }
  // KaTeX sets a fraction with a minus sign in it a little taller than the measured box, so the
  // faulty step gets more room above and below (maths is centred in its box, so nothing shifts).
  const extra = size * 0.2;
  const working = slip[1]!;
  slip[1] = { ...working, y: working.y - extra / 2, h: working.h + extra };
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", slip[1]!, size)];

  // Two bars the same length, one under the other: the given fraction on the left of each, and
  // (once both are cut into common parts) the same fraction over the common denominator on the right.
  const area: Rect =
    format === "desktop"
      ? regionRect(format, regions.bars)
      : (() => {
          const safe = safeArea(CANVAS.mobile.width, CANVAS.mobile.height);
          const y = bottomOf(out.slip) + size * 0.5;
          return { x: textRegion.x, y, width: textRegion.width, height: safe.y + safe.height - y };
        })();
  const leftLabels = [p.first, p.second].map((f) => [frac(f)]);
  const rightLabels = [p.firstOver, p.secondOver].map((f) => [EQUALS, frac(f)]);
  const leftWidth = Math.max(...leftLabels.map((content) => measureMaths(content, LABEL).w));
  const rightWidth = Math.max(...rightLabels.map((content) => measureMaths(content, LABEL).w));
  const side = LABEL * 0.4;
  const x0 = area.x + leftWidth + side;
  const barWidth = area.x + area.width - rightWidth - side - x0;
  const height = LABEL * 2.6;
  const rowGap = LABEL * 0.6;
  const braceLabel: MathNode[] = [frac(p.difference)];
  const room = braceHeight(LABEL, braceLabel);
  const block = room + 2 * height + rowGap;
  const top = format === "desktop" ? area.y + Math.max(0, (area.height - block) / 2) : area.y;
  const firstY = top + room;
  const secondY = firstY + height + rowGap;

  const models = [
    { row: "first", fraction: p.first, y: firstY },
    { row: "second", fraction: p.second, y: secondY },
  ] as const;
  out.bar = [];
  out.part = [];
  const bars: Bar[] = [];
  models.forEach(({ row, fraction, y }, i) => {
    const model = bar({
      id: `bar.${row}`,
      x: x0,
      y,
      parts: fraction.bottom,
      partWidth: barWidth / fraction.bottom,
      height,
      role: "given",
    });
    bars.push(model);
    const shaded = model.span(0, fraction.top);
    out.bar!.push(
      ...model.elements,
      {
        id: `bar.${row}.shade`,
        role: "given",
        type: "rect",
        x: shaded.x,
        y: shaded.y,
        w: shaded.width,
        h: shaded.height,
        fill: true,
      },
      text(`bar.${row}.label`, "given", leftLabels[i]!, area.x, y + height / 2, {
        size: LABEL,
        align: "start",
        valign: "middle",
      }),
    );
    // A bar already in common parts needs no new cuts, and saying "3/4 = 3/4" adds nothing.
    if (fraction.bottom !== p.common) {
      out.part!.push(
        ...cuts(`part.${row}.cut`, model, p, fraction.bottom),
        text(
          `part.${row}.label`,
          "correct",
          rightLabels[i]!,
          x0 + barWidth + side,
          y + height / 2,
          { size: LABEL, align: "start", valign: "middle" },
        ),
      );
    }
  });

  // The difference: the common parts of the first bar beyond the second bar's shading.
  const first = bars[0]!;
  const step = barWidth / p.common;
  const left = first.box.x + p.secondOver.top * step;
  const span: Rect = {
    x: left,
    y: first.box.y,
    width: p.difference.top * step,
    height: first.box.height,
  };
  const difference = brace({
    id: "answer.brace",
    role: "correct",
    span,
    side: "above",
    label: braceLabel,
    size: LABEL,
    within: { x: x0, y: area.y, width: barWidth, height: area.height },
  });
  // The corrected working: under the slip on desktop, under the bars on a phone.
  const placed = stack(
    [{ id: "answer.working", role: "correct", content: correctWorking(p) }],
    format === "desktop"
      ? { ...regionRect(format, regions.notes), y: bottomOf(out.slip) + size * 0.5 }
      : { ...textRegion, y: secondY + height + size * 0.5 },
    { size },
  );
  out.answer = [
    {
      id: "answer.shade",
      role: "correct",
      type: "rect",
      x: span.x,
      y: span.y,
      w: span.width,
      h: span.height,
      fill: true,
    },
    ...difference.elements,
    ...placed,
    markBeside("answer.mark", "correct", "tick", placed[0]!, size),
  ];
  return out;
}

/** The geometry is the same for every beat: work it out once per scene and format. */
const layoutCache = memoise((key) => {
  const [p, format] = JSON.parse(key) as [Params, SceneFormat];
  return computeLayout(p, format);
});

export const fractionSubtract: SceneTemplate<Params> = {
  key: "bar_model.fraction_subtract",
  version: 1,
  primitive: "bar_model",
  node: "N2",
  misconception: "FRAC_SUB_NUM_DEN",
  itemTemplate: "n2-fraction-subtract-unlike",
  title: "Subtracting fractions with different denominators",
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
    const b = integer(item, "b", 2, 9);
    const a = integer(item, "a", 1, b - 1);
    const d = integer(item, "d", 2, 9);
    const c = integer(item, "c", 1, d - 1);
    if (gcd(a, b) !== 1 || gcd(c, d) !== 1)
      throw new Error("Both fractions must be in lowest terms");
    if (a <= c || b <= d) throw new Error("The first numerator and denominator must be the larger");
    if (a * d <= b * c) throw new Error("The first fraction must be the larger");
    const common = (b * d) / gcd(b, d);
    if (common > MAX_COMMON_DENOMINATOR) {
      throw new Error(
        `The lowest common denominator ${common} is over ${MAX_COMMON_DENOMINATOR}: bars cut into that many parts cannot be read on a phone, so this item gets a written explanation instead`,
      );
    }
    const firstOver = { top: (a * common) / b, bottom: common };
    const secondOver = { top: (c * common) / d, bottom: common };
    const difference = { top: firstOver.top - secondOver.top, bottom: common };
    return {
      first: { top: a, bottom: b },
      second: { top: c, bottom: d },
      slip: { top: a - c, bottom: b - d },
      student: simplest(a - c, b - d),
      common,
      firstOver,
      secondOver,
      difference,
      answer: simplest(difference.top, common),
    };
  },

  spec(p, item, studentAnswer) {
    const [first, second, slip, student] = [p.first, p.second, p.slip, p.student].map(words) as [
      string,
      string,
      string,
      string,
    ];
    const [firstOver, secondOver, difference, answer] = [
      p.firstOver,
      p.secondOver,
      p.difference,
      p.answer,
    ].map(words);
    const [own, other] = [pieces(p.first.bottom), pieces(p.second.bottom)];
    return {
      schema: "scene-spec/1",
      template: "bar_model.fraction_subtract@1",
      misconception: "FRAC_SUB_NUM_DEN",
      params: item,
      studentAnswer,
      correctAnswer: rational(p.answer),
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Work out ${first} minus ${second}. Give your answer as a fraction in its simplest form.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `It looks like you took away the numerators, ${p.first.top} minus ${p.second.top}, and the denominators, ${p.first.bottom} minus ${p.second.bottom}, to get ${slip}${same(p.slip, p.student) ? "" : `, which is ${student}`}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          // An answer of 1 or more is plainly more than a proper fraction; a proper fraction only
          // a little more than the first would need the very comparison the student cannot yet do.
          narration: wholeOrMore(p)
            ? `A common slip: taking away the denominators as well. ${student} is more than the ${first} you started with, so it cannot be right.`
            : "A common slip: taking away the denominators as well. A denominator tells you the size of the pieces, not how many to take away.",
        },
        {
          kind: "build",
          focus: ["bar"],
          narration: `Here are ${first} and ${second} on bars the same length. ${capital(own)} and ${other} are different sizes, so you cannot subtract them yet.`,
        },
        {
          kind: "transform",
          focus: ["part"],
          narration:
            p.first.bottom === p.common
              ? `Cut the ${second} bar into ${own} too. ${second} is the same as ${secondOver}, so both are now in ${own}.`
              : `Cut both bars into ${p.common} equal parts, so the pieces match. ${first} is ${firstOver} and ${second} is ${secondOver}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `Take away the numerators and keep the denominator: ${firstOver} minus ${secondOver} leaves ${difference}, the marked part. ${
            same(p.difference, p.answer)
              ? "That is in its simplest form."
              : `That simplifies to ${answer}.`
          }`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    const all = layoutCache(JSON.stringify([p, format]));
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p) {
    // The numerators taken away over the denominators taken away.
    return rational(p.slip);
  },

  claims(p): JsonValue[] {
    const [first, second] = [rational(p.first), rational(p.second)];
    const [firstOver, secondOver] = [rational(p.firstOver), rational(p.secondOver)];
    return [
      ["Equal", ["Subtract", p.first.top, p.second.top], p.slip.top],
      ["Equal", ["Subtract", p.first.bottom, p.second.bottom], p.slip.bottom],
      ["Equal", rational(p.slip), rational(p.student)],
      // Taking away can never leave more than you started with.
      ["Greater", rational(p.student), first],
      wholeOrMore(p) ? ["GreaterEqual", rational(p.student), 1] : ["Less", rational(p.student), 1],
      ["Equal", first, firstOver],
      ["Equal", second, secondOver],
      ["Equal", ["Subtract", firstOver, secondOver], rational(p.difference)],
      ["Equal", rational(p.difference), rational(p.answer)],
      ["Equal", ["Subtract", first, second], rational(p.answer)],
    ];
  },

  sample: { item: { a: 3, b: 4, c: 1, d: 2 }, studentAnswer: 1 },
};
