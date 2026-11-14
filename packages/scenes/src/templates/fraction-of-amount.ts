import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, markBeside, stack, text } from "../layout/geometry";
import { measureMaths } from "../layout/measure";
import type { MathNode, SceneElement, TextElement } from "../layout/types";
import { bar, brace, braceHeight, fitsInPart, partLabel } from "../primitives/bar-model";
import { gcd, integer, LABEL, layoutFor, memoise, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** FRAC_OF_AMOUNT_DIVIDE_ONLY: "3/4 of 20 is 20 ÷ 4 = 5." */

const FOCUS = ["question", "student", "slip", "bar", "part", "answer"] as const;

interface Params {
  /** The fraction n/d, in lowest terms, and the amount it is taken of. */
  n: number;
  d: number;
  amount: number;
  /** One part (amount ÷ d, the student's answer) and n parts (the answer). */
  unit: number;
  answer: number;
}

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.5, h: 0.44 },
    notes: { x: 0.54, y: 0, w: 0.46, h: 0.44 },
    bar: { x: 0.04, y: 0.46, w: 0.92, h: 0.54 },
  },
  // On a phone everything stacks in one column, the bar under the slip.
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    bar: { x: 0, y: 0, w: 1, h: 1 },
  },
});

/** The denominators the item draws, as the narration says one part and several parts. */
const ORDINALS: Record<number, [string, string]> = {
  3: ["third", "thirds"],
  4: ["quarter", "quarters"],
  5: ["fifth", "fifths"],
  6: ["sixth", "sixths"],
  7: ["seventh", "sevenths"],
  8: ["eighth", "eighths"],
  9: ["ninth", "ninths"],
};
const one = (p: Params) => (ORDINALS[p.d] as [string, string])[0];
const many = (p: Params) => (ORDINALS[p.d] as [string, string])[1];

const fraction = (p: Params): MathNode => ({
  frac: [[{ num: String(p.n) }], [{ num: String(p.d) }]],
});
/** "3/4 of 20", as a maths label. */
const fractionOf = (p: Params): MathNode[] => [
  fraction(p),
  { text: " of " },
  { num: String(p.amount) },
];

/** Every element, by focus id. Positions never depend on what is revealed, so nothing shifts. */
function computeLayout(
  p: Params,
  format: SceneFormat,
  taken: boolean,
): Record<string, SceneElement[]> {
  const size = WORKING;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};

  // "Work out" in plain words, then the fraction of the amount beside it, centred on one line.
  const sum = fractionOf(p);
  const centre = textRegion.y + measureMaths(sum, size).h / 2;
  const ask = text("question.ask", "given", "Work out", textRegion.x, centre, {
    size,
    align: "start",
  });
  out.question = [
    ask,
    text("question.sum", "given", sum, ask.x + ask.w + size * 0.1, centre, {
      size,
      align: "start",
    }),
  ];
  out.student = stack(
    [
      {
        id: "student.working",
        role: "student",
        content: `You worked out ${p.amount} ÷ ${p.d} = ${p.unit}`,
      },
    ],
    { ...textRegion, y: bottomOf(out.question) + gap },
    { size },
  );

  // Desktop: the slip sits in a column beside the question. Mobile: one column.
  const notes =
    format === "desktop"
      ? regionRect(format, regions.notes)
      : { ...textRegion, y: bottomOf(out.student) + size * 0.5 };
  const slip = stack(
    [
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      {
        id: "slip.reasoning",
        role: "misconception",
        content: [...fractionOf(p), { op: "=" }, { num: String(p.unit) }],
      },
    ],
    notes,
    { size, spacing: gap },
  );
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", slip[1]!, size)];

  // The bar: the amount over d equal parts, one part's value inside each part.
  const area: Rect =
    format === "desktop"
      ? regionRect(format, regions.bar)
      : { ...textRegion, y: bottomOf(out.slip) + size * 0.5 };
  const height = LABEL * 1.7;
  const block = 2 * braceHeight(LABEL) + height;
  const top = format === "desktop" ? area.y + Math.max(0, (area.height - block) / 2) : area.y;
  const model = bar({
    id: "bar",
    x: area.x,
    y: top + braceHeight(LABEL),
    parts: p.d,
    partWidth: area.width / p.d,
    height,
    role: "given",
  });
  // Once the numerator is used, the parts it takes are shaded: the part itself is filled, so the
  // value inside sits on one shape only.
  const parts: SceneElement[] = model.elements.map((element, i) =>
    taken && i < p.n && element.type === "rect" ? { ...element, fill: true } : element,
  );
  const whole = brace({
    id: "bar.whole",
    role: "given",
    span: model.box,
    side: "above",
    label: String(p.amount),
    size: LABEL,
    within: area,
  });
  const value = String(p.unit);
  const values = fitsInPart(model, [value], LABEL)
    ? Array.from({ length: p.d }, (_, i) =>
        partLabel(model, i, `bar.value.${i}`, "given", value, LABEL),
      )
    : [];
  out.bar = [...parts, ...whole.elements, ...values];

  // The numerator: take n of those parts.
  const take = brace({
    id: "part.take",
    role: "correct",
    span: model.span(0, p.n),
    side: "below",
    label: `${p.n} parts`,
    size: LABEL,
    within: area,
  });
  out.part = take.elements;

  // The answer: under the student's working on desktop, under the bar on a phone.
  const answerAt: Rect =
    format === "desktop"
      ? { ...textRegion, y: bottomOf(out.student) + size * 0.8 }
      : { ...textRegion, y: bottomOf(out.part) + size * 0.5 };
  const answer = stack(
    [
      {
        id: "answer.working",
        role: "correct",
        content: [
          ...fractionOf(p),
          { op: "=" },
          { num: String(p.n) },
          { op: "×" },
          { num: value },
          { op: "=" },
          { num: String(p.answer) },
        ],
      },
    ],
    answerAt,
    { size },
  );
  out.answer = [
    ...answer,
    markBeside("answer.mark", "correct", "tick", answer[0] as TextElement, size),
  ];
  return out;
}

/** The geometry is the same for every beat: work it out once per scene, format and shading. */
const layoutCache = memoise((key) => {
  const [p, format, taken] = JSON.parse(key) as [Params, SceneFormat, boolean];
  return computeLayout(p, format, taken);
});

export const fractionOfAmount: SceneTemplate<Params> = {
  key: "bar_model.fraction_of_amount",
  version: 1,
  primitive: "bar_model",
  node: "N12",
  misconception: "FRAC_OF_AMOUNT_DIVIDE_ONLY",
  itemTemplate: "n12-fraction-of-amount",
  title: "Finding a fraction of an amount",
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
    const d = integer(item, "d", 3, 9);
    // With a numerator of 1, dividing by the denominator is the whole answer: no slip to explain.
    const n = integer(item, "n", 2, d - 1);
    if (gcd(n, d) !== 1) throw new Error("The fraction must be in its lowest terms");
    const amount = integer(item, "amount", 2 * d, 12 * d);
    if (amount % d !== 0) throw new Error("The amount must split into whole parts");
    const unit = amount / d;
    return { n, d, amount, unit, answer: n * unit };
  },

  spec(p, item, studentAnswer) {
    const words = `${p.n}/${p.d} of ${p.amount}`;
    return {
      schema: "scene-spec/1",
      template: "bar_model.fraction_of_amount@1",
      misconception: "FRAC_OF_AMOUNT_DIVIDE_ONLY",
      params: item,
      studentAnswer,
      correctAnswer: p.answer,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Work out ${words}.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You divided ${p.amount} by ${p.d} and got ${p.unit}. That first step is right: ${p.unit} is one ${one(p)} of ${p.amount}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: stopping there. The question asks for ${p.n} ${many(p)} of ${p.amount}, not one ${one(p)}.`,
        },
        {
          kind: "build",
          focus: ["bar"],
          narration: `Draw ${p.amount} as a bar split into ${p.d} equal parts. Each part is ${p.amount} divided by ${p.d}, which is ${p.unit}.`,
        },
        {
          kind: "transform",
          focus: ["part"],
          narration: `The numerator is ${p.n}. It tells you to take ${p.n} of those equal parts, not one.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `${p.n} parts of ${p.unit} make ${p.n} times ${p.unit}, which is ${p.answer}. So ${words} is ${p.answer}.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    const all = layoutCache(JSON.stringify([p, format, revealed.has("part")]));
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // Divided by the denominator and stopped: one part.
    return ["Rational", p.amount, p.d];
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Divide", p.amount, p.d], p.unit],
      ["Equal", ["Multiply", ["Rational", 1, p.d], p.amount], p.unit],
      ["Equal", ["Multiply", p.d, p.unit], p.amount],
      ["Equal", ["Multiply", p.n, p.unit], p.answer],
      ["Equal", ["Multiply", ["Rational", p.n, p.d], p.amount], p.answer],
    ];
  },

  sample: { item: { n: 3, d: 4, amount: 20 }, studentAnswer: 5 },
};
