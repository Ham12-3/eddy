import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber, MINUS } from "../layout/format";
import { bottomOf, markBeside, stack } from "../layout/geometry";
import type { SceneElement } from "../layout/types";
import { bar, brace, braceHeight, fitsInPart, partLabel } from "../primitives/bar-model";
import { gcd, integer, LABEL, layoutFor, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** PCT_REVERSE_APPLY_TO_NEW: "20% off gave £400, so the price before was £400 + 20% of £400." */

interface Params {
  original: number;
  pct: number;
  /** -1 for a reduction (a sale), +1 for an increase (a service charge). */
  sign: -1 | 1;
  /** The price after the change, as the question gives it. */
  changed: number;
  /** The changed price as a percentage of the original: 80 or 110. */
  share: number;
  /** Each part of the bar is this percentage; the bar shows 100% and the changed share in parts. */
  step: number;
  partsWhole: number;
  partsChanged: number;
  /** The value of one part. */
  unit: number;
}

const FOCUS = ["question", "student", "slip", "bar", "part", "answer"] as const;

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.5, h: 0.42 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.42 },
    bar: { x: 0, y: 0.44, w: 1, h: 0.56 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    bar: { x: 0, y: 0, w: 1, h: 1 },
  },
});

const pounds = (value: number) => formatNumber(value, { pounds: true });

/** The student's answer: the percentage applied to the new price and undone from it. */
function studentValue(p: Params): number {
  return (p.changed * (100 - p.sign * p.pct)) / 100;
}

function question(p: Params): string {
  return p.sign < 0
    ? `In a sale, every price is reduced by ${p.pct}%. A coat costs ${pounds(p.changed)} in the sale. Work out its price before the sale.`
    : `A price of ${pounds(p.changed)} includes a ${p.pct}% service charge. Work out the price before the service charge was added.`;
}

/** The bottom edge of the lowest element. */
/** Every element, by focus id. Only the whole bar's label changes, once the answer is shown. */
function layout(p: Params, format: SceneFormat, answered: boolean): Record<string, SceneElement[]> {
  const size = WORKING;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};
  const [changed, unit, original] = [pounds(p.changed), pounds(p.unit), pounds(p.original)];

  out.question = stack([{ id: "question", role: "given", content: question(p) }], textRegion, {
    size,
  });
  out.student = stack(
    [{ id: "student.answer", role: "student", content: `You wrote ${pounds(studentValue(p))}` }],
    { ...textRegion, y: bottomOf(out.question) + gap },
    { size },
  );

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
        content: `${changed} ${p.sign < 0 ? "+" : MINUS} ${p.pct}% of ${changed}`,
      },
    ],
    notes,
    { size, spacing: gap },
  );
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", slip[1]!, size)];

  // One bar of equal parts: 100% (the price before) and the changed share, braced on either side.
  const area: Rect =
    format === "desktop"
      ? regionRect(format, regions.bar)
      : { ...textRegion, y: bottomOf(out.slip) + size * 0.5 };
  // Desktop has room for two rows in each part: its percentage, then (from the next beat) its value.
  const rows = format === "desktop" ? 2 : 1;
  const height = LABEL * (rows === 2 ? 2.7 : 1.6);
  const block = 2 * braceHeight(LABEL) + height;
  const top = format === "desktop" ? area.y + Math.max(0, (area.height - block) / 2) : area.y;
  const parts = Math.max(p.partsWhole, p.partsChanged);
  const partWidth = area.width / parts;
  const model = bar({
    id: "bar",
    x: area.x,
    y: top + braceHeight(LABEL),
    parts,
    partWidth,
    height,
    role: "given",
  });
  // The parts the price is now are drawn in ink; the parts a sale took away are faint outlines.
  // No tint inside the parts: the values written there must keep their full contrast.
  const elements: SceneElement[] = model.elements.map((element, i) =>
    i < p.partsChanged ? element : { ...element, role: "structure" },
  );
  const step = `${p.step}%`;
  const both = rows === 2 && fitsInPart(model, [step, unit], LABEL, 2);
  const values: SceneElement[] = [];
  if (both || fitsInPart(model, [step], LABEL)) {
    for (let i = 0; i < parts; i += 1) {
      elements.push(partLabel(model, i, `bar.step.${i}`, "given", step, LABEL, 0, both ? 2 : 1));
      if (both) values.push(partLabel(model, i, `part.value.${i}`, "correct", unit, LABEL, 1, 2));
    }
  }
  const whole = brace({
    id: "bar.whole",
    role: "correct",
    span: model.span(0, p.partsWhole),
    side: "above",
    label: answered ? `100% = ${original}` : "100%",
    size: LABEL,
    within: area,
  });
  const now = brace({
    id: "bar.changed",
    role: "given",
    span: model.span(0, p.partsChanged),
    side: "below",
    label: `${p.share}% = ${changed}`,
    size: LABEL,
    within: area,
  });
  // The change itself, braced on the side its parts are free: below for a sale, above for a charge.
  const change = brace({
    id: "bar.change",
    role: "given",
    span:
      p.sign < 0
        ? model.span(p.partsChanged, p.partsWhole)
        : model.span(p.partsWhole, p.partsChanged),
    side: p.sign < 0 ? "below" : "above",
    label: p.sign < 0 ? `${p.pct}% off` : `+${p.pct}%`,
    size: LABEL,
    within: area,
  });
  out.bar = [...elements, ...whole.elements, ...now.elements, ...change.elements];

  const working =
    format === "desktop"
      ? { ...notes, y: bottomOf(out.slip) + size * 0.7 }
      : { ...textRegion, y: bottomOf(out.bar) + size * 0.4 };
  out.part = [
    ...values,
    ...stack(
      [
        {
          id: "part.working",
          role: "correct",
          content: `Each ${step} is ${changed} ÷ ${p.partsChanged} = ${unit}`,
        },
      ],
      working,
      { size },
    ),
  ];
  const answer = stack(
    [
      {
        id: "answer.working",
        role: "correct",
        content: `Price before: ${p.partsWhole} × ${unit} = ${original}`,
      },
    ],
    { ...working, y: bottomOf(out.part.filter((element) => element.id === "part.working")) + gap },
    { size },
  );
  out.answer = [...answer, markBeside("answer.mark", "correct", "tick", answer[0]!, size)];
  return out;
}

export const reversePercentage: SceneTemplate<Params> = {
  key: "bar_model.reverse_percentage",
  version: 1,
  primitive: "bar_model",
  node: "R9",
  misconception: "PCT_REVERSE_APPLY_TO_NEW",
  itemTemplate: "r9-reverse-percentage",
  title: "Finding the price before a percentage change",
  focusIds: FOCUS,

  params(item) {
    const original = integer(item, "original", 1, 100000);
    const pct = integer(item, "pct", 1, 99);
    const sign = integer(item, "sign", -1, 1);
    if (sign === 0) throw new Error("Parameter sign must be 1 or -1");
    const share = 100 + sign * pct;
    const step = gcd(pct, 100);
    if ((original * step) % 100 !== 0)
      throw new Error("Each part of the bar must be a whole number of pounds");
    const [partsWhole, partsChanged] = [100 / step, share / step];
    if (Math.max(partsWhole, partsChanged) > 20) throw new Error("Too many parts to draw the bar");
    return {
      original,
      pct,
      sign: sign as -1 | 1,
      changed: (original * share) / 100,
      share,
      step,
      partsWhole,
      partsChanged,
      unit: (original * step) / 100,
    };
  },

  spec(p, item, studentAnswer) {
    const [changed, unit, original] = [pounds(p.changed), pounds(p.unit), pounds(p.original)];
    const sale = p.sign < 0;
    const before = sale ? "the price before the sale" : "the price before the charge";
    return {
      schema: "scene-spec/1",
      template: "bar_model.reverse_percentage@1",
      misconception: "PCT_REVERSE_APPLY_TO_NEW",
      params: item,
      studentAnswer,
      correctAnswer: p.original,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          // The question as it is written, command word included.
          narration: question(p),
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You found ${p.pct}% of ${changed} and ${sale ? "added it on" : "took it away"}, so you got ${pounds(studentValue(p))}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: the ${p.pct}% is a percentage of ${before}, not of ${changed}.`,
        },
        {
          kind: "build",
          focus: ["bar"],
          narration: sale
            ? `Draw ${before} as 100%. Take off ${p.pct}%, and ${changed} is the ${p.share}% that is left.`
            : `Draw ${before} as 100%. Add ${p.pct}%, and ${changed} is ${p.share}% of it.`,
        },
        {
          kind: "transform",
          focus: ["part"],
          narration: `${changed} is ${p.partsChanged} equal parts, each worth ${p.step}%. Each part is ${changed} divided by ${p.partsChanged}, which is ${unit}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `100% is ${p.partsWhole} parts, so ${before} was ${p.partsWhole} times ${unit}, which is ${original}.`,
        },
      ],
    };
  },

  draw(p, format: SceneFormat, revealed) {
    const all = layout(p, format, revealed.has("answer"));
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // The percentage undone from the new price: new × (100 − sign × pct) / 100.
    return ["Rational", p.changed * (100 - p.sign * p.pct), 100];
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Multiply", ["Percent", p.share], p.original], p.changed],
      ["Equal", [p.sign < 0 ? "Subtract" : "Add", 100, p.pct], p.share],
      ["Equal", ["Divide", 100, p.step], p.partsWhole],
      ["Equal", ["Divide", p.share, p.step], p.partsChanged],
      ["Equal", ["Divide", p.changed, p.partsChanged], p.unit],
      ["Equal", ["Multiply", ["Percent", p.step], p.original], p.unit],
      ["Equal", ["Multiply", p.partsWhole, p.unit], p.original],
    ];
  },

  sample: { item: { original: 500, pct: 20, sign: -1 }, studentAnswer: 480 },
};
