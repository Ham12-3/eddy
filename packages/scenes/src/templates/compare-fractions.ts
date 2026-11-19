import type { JsonValue } from "@eddy/schemas";
import { regionRect, safeArea, CANVAS, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, markBeside, stack, text } from "../layout/geometry";
import { measureMaths, measureText } from "../layout/measure";
import type { MathNode, SceneElement, TextElement } from "../layout/types";
import { bar } from "../primitives/bar-model";
import { integer, LABEL, layoutFor, memoise, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** UNIT_FRACTION_BIGGER_DENOMINATOR: "7 is bigger than 3, so 1/7 is bigger than 1/3." */

const FOCUS = ["question", "student", "slip", "bar", "part", "answer"] as const;

interface Params {
  /** The denominators as the question gives them. */
  first: number;
  second: number;
  /** The smaller denominator (the larger fraction) and the bigger one (the student's choice). */
  fewer: number;
  more: number;
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

const ORDINALS: Record<number, string> = {
  2: "half",
  3: "third",
  4: "quarter",
  5: "fifth",
  6: "sixth",
  7: "seventh",
  8: "eighth",
  9: "ninth",
  10: "tenth",
  11: "eleventh",
  12: "twelfth",
};

/** "one third", as the narration says it. */
const spoken = (denominator: number) => `one ${ORDINALS[denominator] as string}`;

/** 1 over the denominator, as a maths label. */
const unit = (denominator: number): MathNode => ({
  frac: [[{ num: "1" }], [{ num: String(denominator) }]],
});
const rational = (denominator: number): JsonValue => ["Rational", 1, denominator];

/** Every element, by focus id. Positions never depend on what is revealed, so nothing shifts. */
function computeLayout(p: Params, format: SceneFormat): Record<string, SceneElement[]> {
  // Phones set the working at the label size: the column has two bars to fit under it.
  const size = format === "desktop" ? WORKING : LABEL;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};

  out.question = stack(
    [
      { id: "question.ask", role: "given", content: "Which is larger?" },
      {
        id: "question.pair",
        role: "given",
        content: [unit(p.first), { text: " or " }, unit(p.second)],
      },
    ],
    textRegion,
    { size, spacing: gap },
  );
  out.student = stack(
    [{ id: "student.choice", role: "student", content: [{ text: "You chose " }, unit(p.more)] }],
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
        // Only the faulty comparison: a cross after "7 > 3 so ..." could read as "7 > 3 is wrong".
        content: [unit(p.more), { op: ">" }, unit(p.fewer)],
      },
    ],
    notes,
    { size, spacing: gap },
  );
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", slip[1]!, size)];

  // The answer: under the slip on desktop; on a phone, beside the student's choice it corrects.
  const choice = out.student[0] as TextElement;
  const answerAt: Rect =
    format === "desktop"
      ? { ...notes, y: bottomOf(out.slip) + size * 0.5 }
      : {
          x: choice.x + choice.w + size * 1.2,
          y: choice.y,
          width: textRegion.x + textRegion.width - (choice.x + choice.w + size * 1.2),
          height: choice.h,
        };
  const answer = stack(
    [
      {
        id: "answer.working",
        role: "correct",
        content: [unit(p.fewer), { op: ">" }, unit(p.more)],
      },
    ],
    answerAt,
    { size },
  );
  out.answer = [...answer, markBeside("answer.mark", "correct", "tick", answer[0]!, size)];

  // Two bars the same length, one row each: a label on the left, the bar to its right.
  const area: Rect =
    format === "desktop"
      ? regionRect(format, regions.bars)
      : (() => {
          const safe = safeArea(CANVAS.mobile.width, CANVAS.mobile.height);
          const y = bottomOf(out.slip) + size * 0.7;
          return { x: textRegion.x, y, width: textRegion.width, height: safe.y + safe.height - y };
        })();
  const rowLabel = (denominator: number) =>
    format === "desktop" ? `${denominator} equal parts` : `${denominator} parts`;
  const labelWidth = Math.max(...[p.first, p.second].map((d) => measureText(rowLabel(d), LABEL).w));
  const x0 = area.x + labelWidth + LABEL * 0.5;
  const barWidth = area.x + area.width - x0;
  // Each shaded part is named just under it: a label drawn inside it would sit on two shapes.
  const height = LABEL * 1.8;
  const below = measureMaths([unit(12)], LABEL).h + LABEL * 0.2;
  const rowGap = LABEL * 0.5;
  const block = 2 * (height + below) + rowGap;
  const top = format === "desktop" ? area.y + Math.max(0, (area.height - block) / 2) : area.y;

  out.bar = [];
  out.part = [];
  (["first", "second"] as const).forEach((row, i) => {
    const denominator = row === "first" ? p.first : p.second;
    const y = top + i * (height + below + rowGap);
    const model = bar({
      id: `bar.${row}`,
      x: x0,
      y,
      parts: denominator,
      partWidth: barWidth / denominator,
      height,
      role: "given",
    });
    out.bar!.push(
      ...model.elements,
      text(`bar.${row}.label`, "given", rowLabel(denominator), area.x, y + height / 2, {
        size: LABEL,
        align: "start",
        valign: "middle",
      }),
    );
    // One part shaded: in the student's colour for their choice, the corrected colour otherwise.
    const shaded = model.part(0);
    out.part!.push(
      {
        id: `part.${row}.shade`,
        role: denominator === p.more ? "student" : "correct",
        type: "rect",
        x: shaded.x,
        y: shaded.y,
        w: shaded.width,
        h: shaded.height,
        fill: true,
      },
      text(
        `part.${row}.label`,
        "given",
        [unit(denominator)],
        shaded.x + shaded.width / 2,
        shaded.y + shaded.height + LABEL * 0.1,
        { size: LABEL, valign: "top" },
      ),
    );
  });
  return out;
}

/** The geometry is the same for every beat: work it out once per scene and format. */
const layoutCache = memoise((key) => {
  const [p, format] = JSON.parse(key) as [Params, SceneFormat];
  return computeLayout(p, format);
});

export const compareFractions: SceneTemplate<Params> = {
  key: "bar_model.compare_fractions",
  version: 1,
  primitive: "bar_model",
  node: "N1",
  misconception: "UNIT_FRACTION_BIGGER_DENOMINATOR",
  itemTemplate: "n1-order-unit-fractions",
  title: "Which unit fraction is larger",
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
    const first = integer(item, "a", 2, 12);
    const second = integer(item, "b", 2, 12);
    if (first === second) throw new Error("The two denominators must differ");
    return {
      first,
      second,
      fewer: Math.min(first, second),
      more: Math.max(first, second),
    };
  },

  spec(p, item, studentAnswer) {
    return {
      schema: "scene-spec/1",
      template: "bar_model.compare_fractions@1",
      misconception: "UNIT_FRACTION_BIGGER_DENOMINATOR",
      params: item,
      studentAnswer,
      correctAnswer: rational(p.fewer),
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Which is larger: ${spoken(p.first)} or ${spoken(p.second)}?`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You chose ${spoken(p.more)}. It looks like you went by the bottom numbers: ${p.more} is bigger than ${p.fewer}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: ${p.more} is bigger than ${p.fewer}, but a bigger denominator cuts the whole into more, smaller pieces.`,
        },
        {
          kind: "build",
          focus: ["bar"],
          narration: `Here are two bars the same length. One is cut into ${p.first} equal parts, the other into ${p.second}.`,
        },
        {
          kind: "transform",
          focus: ["part"],
          narration: `Shade one part of each bar. One part out of ${p.first} is ${spoken(p.first)}. One part out of ${p.second} is ${spoken(p.second)}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `The piece for ${spoken(p.fewer)} is longer. Fewer parts make bigger parts, so ${spoken(p.fewer)} is larger.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    const all = layoutCache(JSON.stringify([p, format]));
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p) {
    // The fraction with the bigger denominator.
    return rational(p.more);
  },

  claims(p): JsonValue[] {
    return [
      ["Less", p.fewer, p.more],
      ["Greater", rational(p.fewer), rational(p.more)],
      ["Equal", ["Multiply", p.first, rational(p.first)], 1],
      ["Equal", ["Multiply", p.second, rational(p.second)], 1],
    ];
  },

  sample: { item: { a: 3, b: 7 }, studentAnswer: ["Rational", 1, 7] },
};
