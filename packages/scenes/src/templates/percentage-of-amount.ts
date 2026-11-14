import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber } from "../layout/format";
import { bottomOf, markBeside, stack } from "../layout/geometry";
import type { SceneElement } from "../layout/types";
import { bar, brace, braceHeight, fitsInPart, partLabel } from "../primitives/bar-model";
import { integer, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** PCT_DIVIDE_BY_PERCENT: "15% of 80, so 80 ÷ 15." */

/** The percentages the item template draws. */
const PERCENTAGES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 60, 75] as const;

interface Params {
  pct: number;
  amount: number;
  /** Each part of the bar is this percentage: 10, or 5 when the percentage is not a multiple of 10. */
  step: number;
  /** Parts in the whole bar (100%), and parts in the percentage asked for. */
  parts: number;
  taken: number;
  /** The value of one part, and the answer. */
  unit: number;
  answer: number;
}

const FOCUS = ["question", "student", "slip", "bar", "part", "answer"] as const;

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.48, h: 0.42 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.42 },
    bar: { x: 0, y: 0.44, w: 1, h: 0.56 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    bar: { x: 0, y: 0, w: 1, h: 1 },
  },
});

const n = (value: number) => formatNumber(value);
const partsWord = (count: number) => `${count} ${count === 1 ? "part" : "parts"}`;

/** The student's answer, when it is a whole number (it often is not: 80 ÷ 15). */
function wholeWrong(p: Params): number | null {
  return p.amount % p.pct === 0 ? p.amount / p.pct : null;
}

/** Every element, by focus id. The bar's step label gives way to the part's value once found. */
function layout(p: Params, format: SceneFormat, found: boolean): Record<string, SceneElement[]> {
  const size = WORKING;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};
  const [pct, step] = [`${p.pct}%`, `${p.step}%`];

  out.question = stack(
    [{ id: "question", role: "given", content: `Work out ${pct} of ${n(p.amount)}.` }],
    textRegion,
    { size },
  );
  const wrong = wholeWrong(p);
  out.student = stack(
    [
      {
        id: "student.working",
        role: "student",
        content: `You worked out ${n(p.amount)} ÷ ${p.pct}${wrong === null ? "" : ` = ${n(wrong)}`}`,
      },
    ],
    { ...textRegion, y: bottomOf(out.question) + gap },
    { size },
  );

  // Desktop: the slip and the working sit in a column beside the question. Mobile: one column.
  const notes =
    format === "desktop"
      ? regionRect(format, regions.notes)
      : { ...textRegion, y: bottomOf(out.student) + size * 0.7 };
  const slip = stack(
    [
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      {
        id: "slip.reasoning",
        role: "misconception",
        content: `${pct} of ${n(p.amount)} = ${n(p.amount)} ÷ ${p.pct}`,
      },
    ],
    notes,
    { size, spacing: gap },
  );
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", slip[1]!, size)];

  // The bar: the whole amount is 100%, in equal parts of 10% (or 5%). Braced above with the whole,
  // below with the parts asked for (from the left) and one part's value (on the right).
  const area: Rect =
    format === "desktop"
      ? regionRect(format, regions.bar)
      : { ...textRegion, y: bottomOf(out.slip) + size * 0.7 };
  // Desktop has room for two rows in each part when they fit: its percentage, then its value.
  const rows = format === "desktop" ? 2 : 1;
  const height = LABEL * (rows === 2 ? 2.7 : 1.6);
  const block = 2 * braceHeight(LABEL) + height;
  const top = format === "desktop" ? area.y + Math.max(0, (area.height - block) / 2) : area.y;
  const model = bar({
    id: "bar",
    x: area.x,
    y: top + braceHeight(LABEL),
    parts: p.parts,
    partWidth: area.width / p.parts,
    height,
    role: "given",
  });
  const unit = n(p.unit);
  const both = rows === 2 && fitsInPart(model, [step, unit], LABEL, 2);
  const inside = both || fitsInPart(model, [step], LABEL);
  const steps: SceneElement[] = [];
  const values: SceneElement[] = [];
  if (inside) {
    for (let i = 0; i < p.parts; i += 1) {
      steps.push(partLabel(model, i, `bar.step.${i}`, "given", step, LABEL, 0, both ? 2 : 1));
      if (both) values.push(partLabel(model, i, `part.value.${i}`, "correct", unit, LABEL, 1, 2));
    }
  }
  const whole = brace({
    id: "bar.whole",
    role: "given",
    span: model.box,
    side: "above",
    label: `100% = ${n(p.amount)}`,
    size: LABEL,
    within: area,
  });
  const last = model.span(p.parts - 1, p.parts);
  // When the parts are too narrow to hold their percentage, one part is braced with it instead.
  const one = inside
    ? []
    : brace({
        id: "bar.one",
        role: "given",
        span: last,
        side: "below",
        label: step,
        size: LABEL,
        within: area,
      }).elements;
  out.bar = [...model.elements, ...steps, ...whole.elements, ...(found ? [] : one)];

  const found1 = brace({
    id: "part.one",
    role: "correct",
    span: last,
    side: "below",
    label: `${step} = ${unit}`,
    size: LABEL,
    within: area,
  });
  const working =
    format === "desktop"
      ? { ...notes, y: bottomOf(out.slip) + size * 0.7 }
      : { ...textRegion, y: bottomOf([...out.bar, ...found1.elements]) + size * 0.5 };
  const partWorking = stack(
    [
      {
        id: "part.working",
        role: "correct",
        content: `${step} = ${n(p.amount)} ÷ ${p.parts} = ${unit}`,
      },
    ],
    working,
    { size },
  );
  out.part = [...values, ...found1.elements, ...partWorking];

  const taken = brace({
    id: "answer.taken",
    role: "correct",
    span: model.span(0, p.taken),
    side: "below",
    label: `${pct} = ${n(p.answer)}`,
    size: LABEL,
    within: area,
  });
  const answer = stack(
    [
      {
        id: "answer.working",
        role: "correct",
        content: `${pct} = ${p.taken} × ${unit} = ${n(p.answer)}`,
      },
    ],
    { ...working, y: bottomOf(partWorking) + gap },
    { size },
  );
  // The parts that make up the percentage, washed with the highlighter ("look here"). When the
  // parts also hold their value (correct text, too faint on the wash), only the top row is washed:
  // the ink percentages being counted.
  const run = model.span(0, p.taken);
  const inset = LABEL * 0.08;
  const shade: SceneElement = {
    id: "answer.shade",
    role: "highlight",
    type: "rect",
    x: run.x + inset,
    y: run.y + inset,
    w: run.width - 2 * inset,
    h: (both ? run.height / 2 : run.height) - 2 * inset,
    fill: true,
  };
  out.answer = [
    shade,
    ...taken.elements,
    ...answer,
    markBeside("answer.mark", "correct", "tick", answer[0]!, size),
  ];
  return out;
}

export const percentageOfAmount: SceneTemplate<Params> = {
  key: "bar_model.percentage_of_amount",
  version: 1,
  primitive: "bar_model",
  node: "N12",
  misconception: "PCT_DIVIDE_BY_PERCENT",
  itemTemplate: "n12-percentage-of-amount",
  title: "Finding a percentage of an amount",
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
    const pct = integer(item, "pct", 5, 75);
    if (!(PERCENTAGES as readonly number[]).includes(pct)) {
      throw new Error(`Parameter pct must be one of ${PERCENTAGES.join(", ")}`);
    }
    if (pct === 10) {
      // 10% of an amount is the amount divided by 10: dividing by the percentage is right here.
      throw new Error("With 10%, dividing by the percentage is right: there is no slip to explain");
    }
    const amount = integer(item, "amount", 20, 240);
    if (amount % 20 !== 0) throw new Error("Parameter amount must be a multiple of 20");
    // Parts of 10% when the percentage is a whole number of tens, else parts of 5%.
    const step = pct % 10 === 0 ? 10 : 5;
    const parts = 100 / step;
    const unit = amount / parts;
    const taken = pct / step;
    return { pct, amount, step, parts, taken, unit, answer: unit * taken };
  },

  spec(p, item, studentAnswer) {
    const [pct, step, amount, unit] = [`${p.pct}%`, `${p.step}%`, n(p.amount), n(p.unit)];
    const wrong = wholeWrong(p);
    return {
      schema: "scene-spec/1",
      template: "bar_model.percentage_of_amount@1",
      misconception: "PCT_DIVIDE_BY_PERCENT",
      params: item,
      studentAnswer,
      correctAnswer: p.answer,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          // The question as it is written, command word included.
          narration: `Work out ${pct} of ${amount}.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration:
            wrong === null
              ? `You divided ${amount} by ${p.pct}.`
              : `You divided ${amount} by ${p.pct} and got ${n(wrong)}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: dividing by ${p.pct}. Per cent means out of 100, so the whole of ${amount} is 100%.`,
        },
        {
          kind: "build",
          focus: ["bar"],
          narration: `Draw ${amount} as a bar worth 100%. Split it into ${p.parts} equal parts, so each part is ${step}.`,
        },
        {
          kind: "transform",
          focus: ["part"],
          narration: `Each part is ${amount} divided by ${p.parts}, which is ${unit}. So ${step} of ${amount} is ${unit}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration:
            p.taken === 1
              ? `${pct} is 1 part, so ${pct} of ${amount} is ${n(p.answer)}.`
              : `${pct} is ${partsWord(p.taken)} of ${step}, so ${pct} of ${amount} is ${p.taken} times ${unit}, which is ${n(p.answer)}.`,
        },
      ],
    };
  },

  draw(p, format: SceneFormat, revealed) {
    const all = layout(p, format, revealed.has("part"));
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // The amount divided by the percentage.
    return ["Rational", p.amount, p.pct];
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Divide", 100, p.step], p.parts],
      ["Equal", ["Divide", p.amount, p.parts], p.unit],
      ["Equal", ["Multiply", ["Percent", p.step], p.amount], p.unit],
      ["Equal", ["Divide", p.pct, p.step], p.taken],
      ["Equal", ["Multiply", p.taken, p.unit], p.answer],
      ["Equal", ["Multiply", ["Percent", p.pct], p.amount], p.answer],
    ];
  },

  sample: { item: { pct: 15, amount: 80 }, studentAnswer: ["Rational", 16, 3] },
};
