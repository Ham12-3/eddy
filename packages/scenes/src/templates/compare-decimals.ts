import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, markBeside, stack, text } from "../layout/geometry";
import type { SceneElement } from "../layout/types";
import { numberLine, pointsOn } from "../primitives/number-line";
import { decimal, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** DEC_LONGER_IS_BIGGER: "397 is bigger than 5, so 0.397 is bigger than 0.5." */

interface Params {
  /** One decimal place ("0.5") and three ("0.397"), as the question gives them. */
  short: string;
  long: string;
  /** Their tenths digits, and the long decimal's digits read as a whole number. */
  shortTenths: number;
  longTenths: number;
  longDigits: number;
}

const FOCUS = ["question", "student", "line", "slip", "tenths", "answer"] as const;

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.48, h: 0.52 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.52 },
    line: { x: 0, y: 0.56, w: 1, h: 0.44 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 0.66 },
    notes: { x: 0, y: 0, w: 1, h: 0.66 },
    line: { x: 0, y: 0.68, w: 1, h: 0.32 },
  },
});

/** The bottom edge of the lowest element. */
/** "1 tenth", "3 tenths"; with `none`, a zero is "no tenths". */
function tenths(count: number, none = false): string {
  if (count === 0 && none) return "no tenths";
  return `${count} ${count === 1 ? "tenth" : "tenths"}`;
}

/**
 * The two decimals one above the other, a digit to a column so they line up at the point, with
 * the tenths column highlighted and named, and the comparison of the tenths beside them.
 */
function tenthsBlock(p: Params, area: Rect, size: number): SceneElement[] {
  const [digitColumn, pointColumn] = [size * 0.9, size * 0.5];
  const header = text("tenths.header", "structure", "tenths", 0, 0, { size: LABEL, valign: "top" });
  const left = area.x;
  // Column centres: the ones digit, the point, then one column for each decimal place.
  const centre = (column: number) =>
    column === 0
      ? left + digitColumn / 2
      : column === 1
        ? left + digitColumn + pointColumn / 2
        : left + pointColumn + digitColumn * (column - 0.5);
  const rowHeight = size * 1.25;
  const top = area.y + header.h + size * 0.25;
  const elements: SceneElement[] = [];
  const rows = [
    { id: "tenths.short", value: p.short },
    { id: "tenths.long", value: p.long },
  ];
  rows.forEach((row, r) => {
    const cy = top + rowHeight * (r + 0.5) + size * 0.15 * r;
    [...row.value].forEach((char, column) => {
      elements.push(text(`${row.id}.${column}`, "given", char, centre(column), cy, { size }));
    });
  });
  const pad = size * 0.12;
  const columnLeft = centre(2) - digitColumn / 2;
  const highlight: SceneElement = {
    id: "tenths.column",
    role: "highlight",
    type: "rect",
    x: columnLeft + pad,
    y: top - pad,
    w: digitColumn - 2 * pad,
    h: 2 * rowHeight + size * 0.15 + 2 * pad,
    fill: true,
  };
  const label = { ...header, x: centre(2) - header.w / 2, y: area.y };
  const caption = text(
    "tenths.compare",
    "correct",
    `${tenths(p.shortTenths)} > ${tenths(p.longTenths)}`,
    centre(4) + digitColumn / 2 + size * 0.8,
    top + rowHeight + size * 0.075,
    { size, align: "start" },
  );
  return [highlight, label, ...elements, caption];
}

function layout(p: Params, format: SceneFormat): Record<string, SceneElement[]> {
  const size = WORKING;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};

  out.question = stack(
    [{ id: "question", role: "given", content: `Which is larger: ${p.short} or ${p.long}?` }],
    textRegion,
    { size },
  );
  out.student = stack(
    [{ id: "student.choice", role: "student", content: `You chose ${p.long}` }],
    { ...textRegion, y: bottomOf(out.question) + gap },
    { size },
  );

  const notes =
    format === "desktop"
      ? regionRect(format, regions.notes)
      : { ...textRegion, y: bottomOf(out.student) + size * 0.6 };
  const slip = stack(
    [
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      {
        id: "slip.reasoning",
        role: "misconception",
        content: `${p.longDigits} > ${p.shortTenths}, so ${p.long} > ${p.short}`,
      },
    ],
    notes,
    { size, spacing: gap },
  );
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", slip[1]!, size)];

  const tenthsArea =
    format === "desktop"
      ? { ...textRegion, y: bottomOf(out.student) + size * 0.9 }
      : { ...textRegion, y: bottomOf(out.slip) + size * 0.6 };
  out.tenths = tenthsBlock(p, tenthsArea, size);

  const answerArea =
    format === "desktop"
      ? { ...notes, y: bottomOf(out.slip) + size * 0.6 }
      : { ...textRegion, y: bottomOf(out.tenths) + size * 0.5 };
  const answer = stack(
    [
      {
        id: "answer.text",
        role: "correct",
        content: `${p.short} > ${p.long}, so ${p.short} is larger`,
      },
    ],
    answerArea,
    { size },
  );

  const line = numberLine({
    id: "line",
    region: regionRect(format, regions.line),
    min: 0,
    max: 1,
    tick: 0.1,
    labelEvery: format === "desktop" ? 1 : 5,
    size: LABEL,
    at: 0.6,
  });
  out.line = [
    ...line.elements,
    ...pointsOn(
      line,
      [
        { id: "line.short", value: Number(p.short), role: "given", label: p.short },
        { id: "line.long", value: Number(p.long), role: "student", label: p.long },
      ],
      size,
    ),
  ];
  const r = size * 0.55;
  out.answer = [
    ...answer,
    {
      id: "answer.ring",
      role: "correct",
      type: "mark",
      kind: "ring",
      x: line.x(Number(p.short)) - r,
      y: line.y - r,
      w: 2 * r,
      h: 2 * r,
    },
  ];
  return out;
}

export const compareDecimals: SceneTemplate<Params> = {
  key: "number_line.compare_decimals",
  version: 1,
  primitive: "number_line",
  node: "N1",
  misconception: "DEC_LONGER_IS_BIGGER",
  itemTemplate: "n1-order-decimals",
  title: "Which decimal is larger",
  focusIds: FOCUS,
  beatKinds: withRefocusKinds(
    "show_given",
    "show_student_working",
    "highlight_slip",
    "build",
    "compare",
    "reveal_correct",
  ),

  params(item) {
    const short = decimal(item, "short", 0, 1);
    const long = decimal(item, "long", 0, 1);
    if (!/^0\.\d$/.test(short) || !/^0\.\d\d\d$/.test(long)) {
      throw new Error("Expected one decimal with one place and one with three");
    }
    if (Number(long) >= Number(short)) {
      throw new Error("The longer decimal is the larger here, so this slip gives the right answer");
    }
    return {
      short,
      long,
      shortTenths: Number(short[2]),
      longTenths: Number(long[2]),
      longDigits: Number(long.slice(2)),
    };
  },

  spec(p, item, studentAnswer) {
    return {
      schema: "scene-spec/1",
      template: "number_line.compare_decimals@1",
      misconception: "DEC_LONGER_IS_BIGGER",
      params: item,
      studentAnswer,
      correctAnswer: { num: p.short },
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Which is larger: ${p.short} or ${p.long}?`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You chose ${p.long}. It has more digits, so it looks bigger.`,
        },
        {
          kind: "build",
          focus: ["line"],
          narration:
            "Put both numbers on a number line from 0 to 1, marked in tenths. Larger numbers are further right.",
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: ${p.longDigits} is bigger than ${p.shortTenths}, but these digits are not one number. Each digit has its own place value.`,
        },
        {
          kind: "compare",
          focus: ["tenths"],
          narration: `Compare the tenths first. ${p.short} has ${tenths(p.shortTenths)}. ${p.long} has ${p.longTenths === 0 ? "" : "only "}${tenths(p.longTenths, true)}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `${tenths(p.shortTenths)} is more than ${p.longTenths === 0 ? "none" : tenths(p.longTenths)}, so ${p.short} is the larger number. It is further right on the line.`,
        },
      ],
    };
  },

  draw(p, format: SceneFormat, revealed) {
    const all = layout(p, format);
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // The decimal with more digits.
    return { num: p.long };
  },

  claims(p): JsonValue[] {
    const [short, long] = [{ num: p.short }, { num: p.long }];
    return [
      ["Greater", short, long],
      ["Greater", p.longDigits, p.shortTenths],
      ["Equal", short, ["Divide", p.shortTenths, 10]],
      ["Less", ["Divide", p.longTenths, 10], long],
      ["Less", long, ["Divide", p.longTenths + 1, 10]],
      ["Greater", p.shortTenths, p.longTenths],
      [
        "Equal",
        long,
        [
          "Add",
          ["Divide", p.longTenths, 10],
          ["Divide", Number(p.long[3]), 100],
          ["Divide", Number(p.long[4]), 1000],
        ],
      ],
      ["Less", 0, long],
      ["Less", short, 1],
    ];
  },

  sample: { item: { short: "0.5", long: "0.397" }, studentAnswer: ["Rational", 397, 1000] },
};
