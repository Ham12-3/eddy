import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { bottomOf, markBeside, stack, text } from "../layout/geometry";
import type { MathNode, SceneElement } from "../layout/types";
import { digitIn, placeValueChart, powerOfTen } from "../primitives/place-value-slider";
import { decimal, integer, LABEL, layoutFor, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** SF_NEGATIVE_POWER_DIRECTION: "8.2 × 10 to the power -3 = 8200": the digits moved the wrong way. */

interface Params {
  /** The number in front, as the question writes it ("8.2"), and the power (negative). */
  m: string;
  k: number;
  /** The ordinary number, and the student's (the digits moved |k| places left). */
  answer: string;
  wrong: string;
}

const FOCUS = ["question", "student", "slip", "chart", "move", "answer"] as const;

/** The chart starts at the ones column: the digits start there, and the zero lands there. */
const HIGH = 0;
const DIGIT = WORKING * 1.4;
/**
 * Maths lines with a power of ten are set larger than working text, so the raised power (smaller
 * than the line) still reads at the narrowest stage.
 */
const MATHS: Record<SceneFormat, number> = { desktop: 48, mobile: 52 };

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.46, h: 0.36 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.36 },
    chart: { x: 0, y: 0.38, w: 1, h: 0.62 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    chart: { x: 0, y: 0, w: 1, h: 1 },
  },
});

/**
 * A decimal written as text times 10 to a whole power, written out in full: ("8.2", -3) is
 * "0.0082" and ("8.2", 3) is "8200". Done on the digits, so no rounding can creep in.
 */
export function shiftPoint(m: string, k: number): string {
  const [whole = "", fraction = ""] = m.split(".");
  const digits = `${whole}${fraction}`;
  const point = whole.length + k;
  const padded = point <= 0 ? `${"0".repeat(1 - point)}${digits}` : digits.padEnd(point, "0");
  const at = Math.max(point, 1);
  const result = `${padded.slice(0, at)}.${padded.slice(at)}`.replace(/^0+(?=\d)/, "");
  // Trailing zeros after the point go, then the point itself if nothing follows it.
  return result.replace(/0+$/, "").replace(/\.$/, "");
}

/** "1 place" or "3 places". */
function count(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** "8.2 × 10^-3", then any more nodes. */
function expression(p: Params, ...rest: MathNode[]): MathNode[] {
  return [{ num: p.m }, { op: "×" }, ...powerOfTen(p.k), ...rest];
}

/** The bottom edge of the lowest element. */
function layout(p: Params, format: SceneFormat, moved: boolean): Record<string, SceneElement[]> {
  const size = WORKING;
  const gap = size * 0.3;
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};

  const maths = MATHS[format];
  const words = stack(
    [{ id: "question.words", role: "given", content: "Write as an ordinary number:" }],
    textRegion,
    { size },
  );
  out.question = [
    ...words,
    ...stack(
      [{ id: "question.number", role: "given", content: expression(p) }],
      { ...textRegion, y: bottomOf(words) + gap * 0.5 },
      { size: maths },
    ),
  ];
  out.student = stack(
    // As the student wrote it, and as the maths line beside it shows it: no thousands commas.
    [{ id: "student.answer", role: "student", content: `You wrote ${p.wrong}` }],
    { ...textRegion, y: bottomOf(out.question) + gap },
    { size },
  );

  const notes =
    format === "desktop"
      ? regionRect(format, regions.notes)
      : { ...textRegion, y: bottomOf(out.student) + size * 0.5 };
  const title = stack(
    [{ id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" }],
    notes,
    { size },
  );
  const slip = [
    ...title,
    ...stack(
      [
        {
          id: "slip.reasoning",
          role: "misconception",
          content: expression(p, { op: "=" }, { num: p.wrong }),
        },
      ],
      { ...notes, y: bottomOf(title) + gap * 0.5 },
      { size: maths },
    ),
  ];
  out.slip = [...slip, markBeside("slip.mark", "misconception", "cross", slip[1]!, size)];

  // The chart: ones down to the column the last digit lands in. Place names head the columns
  // on desktop; a phone is too narrow for them, so there the powers of ten are set larger.
  const digits = p.m.replace(".", "");
  const low = p.k - (digits.length - 1);
  const area: Rect =
    format === "desktop"
      ? regionRect(format, regions.chart)
      : { ...textRegion, y: bottomOf(out.slip) + size * 0.7 };
  const chart = placeValueChart({
    id: "chart",
    region: area,
    high: HIGH,
    low,
    nameSize: format === "desktop" ? LABEL : 0,
    powerSize: format === "desktop" ? LABEL : 56,
    digitSize: DIGIT,
    maxColumn: format === "desktop" ? 240 : 150,
  });
  // The first digit is in the ones column; once moved, every digit is |k| columns to the right.
  const shift = moved ? p.k : 0;
  out.chart = [
    ...chart.elements,
    ...[...digits].map((digit, i) =>
      digitIn(chart, `chart.digit.${i}`, digit, -i + shift, "given", DIGIT),
    ),
  ];

  // The move: an arrow under the digits from where the first digit was to where it lands.
  const [from, to] = [chart.cell(0), chart.cell(p.k)];
  const arrowY = chart.box.y + chart.box.height + size * 0.6;
  const arrow: SceneElement = {
    id: "move.arrow",
    role: "correct",
    type: "line",
    x1: from.x + from.width / 2,
    y1: arrowY,
    x2: to.x + to.width / 2,
    y2: arrowY,
    width: 5,
    arrow: true,
  };
  const places = -p.k;
  const label = text(
    "move.label",
    "correct",
    `${count(places, "place")} to the right`,
    (from.x + to.x + to.width) / 2,
    arrowY + size * 0.6,
    {
      size,
      valign: "top",
    },
  );
  out.move = [arrow, label];

  // Zeros hold the empty places from the ones column up to the first digit.
  const zeros = Array.from({ length: places }, (_, i) =>
    digitIn(chart, `answer.zero.${i}`, "0", -i, "correct", DIGIT),
  );
  const answerArea =
    format === "desktop"
      ? { ...notes, y: bottomOf(out.slip) + size * 0.6 }
      : { ...textRegion, y: bottomOf(out.move) + size * 0.5 };
  const answer = stack(
    [
      {
        id: "answer.result",
        role: "correct",
        content: expression(p, { op: "=" }, { num: p.answer }),
      },
    ],
    answerArea,
    { size: maths },
  );
  out.answer = [
    ...zeros,
    ...answer,
    markBeside("answer.mark", "correct", "tick", answer[0]!, size),
  ];
  return out;
}

export const negativePower: SceneTemplate<Params> = {
  key: "place_value_slider.negative_power",
  version: 1,
  primitive: "place_value_slider",
  node: "N9",
  misconception: "SF_NEGATIVE_POWER_DIRECTION",
  itemTemplate: "n9-standard-to-ordinary",
  title: "Standard form with a negative power",
  focusIds: FOCUS,

  params(item) {
    const m = decimal(item, "m", 1, 9.9);
    if (!/^[1-9]\.[1-9]$/.test(m)) throw new Error("Parameter m must be from 1.1 to 9.9, as d.d");
    const k = integer(item, "k", -4, 4);
    if (k >= 0)
      throw new Error("The power is not negative, so the digits cannot have moved the wrong way");
    return { m, k, answer: shiftPoint(m, k), wrong: shiftPoint(m, -k) };
  },

  spec(p, item, studentAnswer) {
    const places = -p.k;
    const said = `${p.m} times 10 to the power of negative ${places}`;
    const [ones, tenths] = p.m.split(".").map(Number) as [number, number];
    return {
      schema: "scene-spec/1",
      template: "place_value_slider.negative_power@1",
      misconception: "SF_NEGATIVE_POWER_DIRECTION",
      params: item,
      studentAnswer,
      correctAnswer: { num: p.answer },
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Write ${said} as an ordinary number.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You wrote ${p.wrong}. You moved the digits ${count(places, "place")} to the left.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: ${p.wrong} is bigger than ${p.m}, but a negative power of 10 makes a number smaller.`,
        },
        {
          kind: "build",
          focus: ["chart"],
          narration: `Here is ${p.m} in a place value table: ${count(ones, "one")} and ${count(tenths, "tenth")}. The tenths column is 10 to the power of negative 1.`,
        },
        {
          kind: "transform",
          focus: ["move"],
          narration: `Multiplying by 10 to the power of negative ${places} is the same as dividing by ${10 ** places}. Every digit moves ${count(places, "place")} to the right.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `Zeros fill the empty places. So ${said} is ${p.answer}.`,
        },
      ],
    };
  },

  draw(p, format: SceneFormat, revealed) {
    const all = layout(p, format, revealed.has("move"));
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // The digits moved the other way: m times 10 to the power -k.
    return { num: p.wrong };
  },

  claims(p): JsonValue[] {
    const places = -p.k;
    const digits = [...p.m.replace(".", "")].map(Number);
    return [
      ["Equal", ["Multiply", { num: p.m }, ["Power", 10, p.k]], { num: p.answer }],
      ["Equal", ["Power", 10, p.k], ["Divide", 1, 10 ** places]],
      ["Equal", ["Power", 10, -1], ["Divide", 1, 10]],
      ["Equal", { num: p.m }, ["Add", ...digits.map((digit, i) => ["Divide", digit, 10 ** i])]],
      ["Greater", { num: p.wrong }, { num: p.m }],
      ["Less", { num: p.answer }, { num: p.m }],
      ["Greater", { num: p.answer }, 0],
    ];
  },

  sample: { item: { m: "8.2", k: -3 }, studentAnswer: 8200 },
};
