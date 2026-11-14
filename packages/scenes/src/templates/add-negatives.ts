import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber } from "../layout/format";
import { bottomOf, bounds, markBeside, stack, text } from "../layout/geometry";
import { measureText } from "../layout/measure";
import type { SceneElement, TextElement } from "../layout/types";
import { numberLine, pointOn } from "../primitives/number-line";
import { integer, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** NEG_TWO_NEGATIVES_ADD_POSITIVE: "two negatives make a positive, so −3 + (−4) = 7." */

const FOCUS = ["question", "student", "slip", "line", "move", "answer"] as const;

interface Params {
  /** The question is −a + (−b); both are positive sizes. */
  a: number;
  b: number;
  /** a + b: the student's answer, and the size of the correct one. */
  sum: number;
}

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.46, h: 0.46 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.46 },
    line: { x: 0, y: 0.5, w: 1, h: 0.5 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    line: { x: 0, y: 0, w: 1, h: 1 },
  },
});

/** "−3 + (−4)" */
function sumText(p: Params): string {
  return `${formatNumber(-p.a)} + (${formatNumber(-p.b)})`;
}

/**
 * The scale runs from a multiple of the label step below the answer up to 5, so zero and the
 * answer are both on it. Labels come every 5 when they have room, otherwise every 10.
 */
function scale(p: Params, width: number): { min: number; max: number; step: number } {
  const max = 5;
  for (const step of [5, 10]) {
    const min = -Math.ceil((p.sum + 1) / step) * step;
    const label = measureText(formatNumber(min), LABEL).w;
    // Roughly the drawn length of one step: the line loses about a label's width at the ends.
    const perStep = ((width - 2 * label) / (max - min)) * step;
    if (perStep >= label + LABEL) return { min, max, step };
  }
  const step = 10;
  return { min: -Math.ceil((p.sum + 1) / step) * step, max, step };
}

/**
 * The number line with the start point, the move and the landing point, built with the axis at
 * `axisY`. Grouped by focus id.
 */
function lineBlock(p: Params, area: Rect, axisY: number): Record<string, SceneElement[]> {
  const { min, max, step } = scale(p, area.width);
  const line = numberLine({
    id: "line",
    region: { x: area.x, y: axisY, width: area.width, height: 0 },
    min,
    max,
    tick: 1,
    labelEvery: step,
    size: LABEL,
    at: 0,
  });
  // The landing point's label goes a row higher when it would sit too close to the start's.
  const start = pointOn(line, "line.start", -p.a, "given", LABEL);
  let end = pointOn(line, "answer.end", -p.sum, "correct", LABEL);
  const [startLabel, endLabel] = [bounds(start[1]!), bounds(end[1]!)];
  if (endLabel.x + endLabel.width + LABEL * 0.4 > startLabel.x) {
    end = end.map((e) => (e.type === "text" ? { ...e, y: e.y - LABEL * 1.35 } : e));
  }
  const points = [...start, ...end];
  const labelsTop = Math.min(...points.filter((e) => e.type === "text").map((e) => bounds(e).y));

  // The move: an arrow from the start to the landing point, above the point labels.
  const gap = LABEL * 0.25;
  const arrowPad = 2 + 12;
  const arrowY = labelsTop - gap - arrowPad;
  const arrow: SceneElement = {
    id: "move.arrow",
    role: "correct",
    type: "line",
    x1: line.x(-p.a),
    y1: arrowY,
    x2: line.x(-p.sum),
    y2: arrowY,
    width: 4,
    arrow: true,
  };
  const content = `add ${formatNumber(-p.b)}: move ${p.b} left`;
  const half = measureText(content, LABEL).w / 2;
  const middle = (line.x(-p.a) + line.x(-p.sum)) / 2;
  const cx = Math.min(Math.max(middle, area.x + half), area.x + area.width - half);
  const label = text("move.label", "correct", content, cx, arrowY - arrowPad - gap, {
    size: LABEL,
    valign: "bottom",
  });

  const r = LABEL * 0.6;
  return {
    line: [...line.elements, ...points.filter((e) => e.id.startsWith("line."))],
    move: [arrow, label],
    answer: [
      ...points.filter((e) => e.id.startsWith("answer.")),
      {
        id: "answer.ring",
        role: "correct",
        type: "mark",
        kind: "ring",
        x: line.x(-p.sum) - r,
        y: line.y - r,
        w: 2 * r,
        h: 2 * r,
      },
    ],
  };
}

/** Every element, by focus id, with nothing revealed yet left out: positions never shift. */
function layout(p: Params, format: SceneFormat): Record<string, SceneElement[]> {
  const size = WORKING;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};

  out.question = stack(
    [{ id: "question", role: "given", content: `Work out ${sumText(p)}` }],
    textRegion,
    { size },
  );
  out.student = stack(
    [{ id: "student.answer", role: "student", content: `You answered ${p.sum}` }],
    { ...textRegion, y: bottomOf(out.question) + gap },
    { size },
  );

  // Desktop: the slip sits in a column beside the question. Mobile: one column.
  const notes =
    format === "desktop"
      ? regionRect(format, regions.notes)
      : { ...textRegion, y: bottomOf(out.student) + size * 0.7 };
  const slip = stack(
    [
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      { id: "slip.rule", role: "misconception", content: '"Two negatives make a positive"' },
      { id: "slip.working", role: "misconception", content: `${sumText(p)} = ${p.sum}` },
    ],
    notes,
    { size, spacing: gap },
  );
  const working = slip[2] as TextElement;
  const note = stack(
    [{ id: "slip.note", role: "correct", content: "That rule is not for adding" }],
    { ...notes, y: bottomOf(slip) + gap },
    { size },
  );
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", working, size), ...note];

  // The number line: centred in its region on desktop, after the slip on mobile.
  const area =
    format === "desktop"
      ? regionRect(format, regions.line)
      : { ...textRegion, y: bottomOf(out.slip) + size * 0.7 };
  const trial = Object.values(lineBlock(p, area, 0)).flat();
  const top = Math.min(...trial.map((e) => bounds(e).y));
  const height = bottomOf(trial) - top;
  const blockTop = format === "desktop" ? area.y + Math.max(0, (area.height - height) / 2) : area.y;
  const block = lineBlock(p, area, blockTop - top);
  out.line = block.line ?? [];
  out.move = block.move ?? [];

  // The answer: under the student's answer on desktop, under the number line on mobile.
  const answerArea =
    format === "desktop"
      ? { ...textRegion, y: bottomOf(out.student) + size * 0.7 }
      : { ...textRegion, y: bottomOf([...out.line, ...out.move]) + size * 0.5 };
  const answer = stack(
    [
      {
        id: "answer.text",
        role: "correct",
        content: `${sumText(p)} = ${formatNumber(-p.sum)}`,
      },
    ],
    answerArea,
    { size },
  );
  out.answer = [
    ...(block.answer ?? []),
    ...answer,
    markBeside("answer.mark", "correct", "tick", answer[0]!, size),
  ];
  return out;
}

export const addNegatives: SceneTemplate<Params> = {
  key: "number_line.add_negatives",
  version: 1,
  primitive: "number_line",
  node: "N2",
  misconception: "NEG_TWO_NEGATIVES_ADD_POSITIVE",
  itemTemplate: "n2-add-negatives",
  title: "Adding two negative numbers",
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
    const a = integer(item, "a", 2, 15);
    const b = integer(item, "b", 2, 15);
    return { a, b, sum: a + b };
  },

  spec(p, item, studentAnswer) {
    const [start, minusB, answer] = [formatNumber(-p.a), formatNumber(-p.b), formatNumber(-p.sum)];
    return {
      schema: "scene-spec/1",
      template: "number_line.add_negatives@1",
      misconception: "NEG_TWO_NEGATIVES_ADD_POSITIVE",
      params: item,
      studentAnswer,
      correctAnswer: -p.sum,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Work out ${sumText(p)}. You are adding a negative number to a negative number.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You answered ${p.sum}. It looks as if you used the rule that two negatives make a positive.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: "two negatives make a positive" is a rule for multiplying and dividing. It does not work for adding.`,
        },
        {
          kind: "build",
          focus: ["line"],
          narration: `Start at ${start} on the number line. Numbers get smaller as you go left.`,
        },
        {
          kind: "transform",
          focus: ["move"],
          narration: `Adding a negative moves you left, down the number line. So adding ${minusB} means moving ${p.b} places left.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `You land on ${answer}. Adding two negatives takes you further below zero, so ${sumText(p)} = ${answer}.`,
        },
      ],
    };
  },

  draw(p, format: SceneFormat, revealed) {
    const all = layout(p, format);
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // Two negatives taken to make a positive: a + b.
    return p.sum;
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Add", -p.a, -p.b], -p.sum],
      ["Equal", ["Subtract", -p.a, p.b], -p.sum],
      ["Equal", ["Add", p.a, p.b], p.sum],
      ["Less", -p.sum, -p.a],
      ["Less", -p.sum, 0],
    ];
  },

  sample: { item: { a: 3, b: 4 }, studentAnswer: 7 },
};
