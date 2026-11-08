import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber } from "../layout/format";
import { bottomOf, bounds, stack } from "../layout/geometry";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import type { SceneElement, TextElement } from "../layout/types";
import { bar, brace, braceHeight, fitsInPart, partLabel } from "../primitives/bar-model";
import { integer, LABEL, layoutFor, oneOf, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** RATIO_DIVIDE_BY_EACH_PART: "£42 in the ratio 1 : 2, so Ben gets £42 ÷ 2." */

const NAMES = { a: "Asha", b: "Ben" } as const;
const FOCUS = ["question", "student", "slip", "bar", "part", "answer"] as const;

interface Params {
  a: number;
  b: number;
  total: number;
  ask: "a" | "b";
  /** The asked person's number in the ratio, and the other person's. */
  asked: number;
  parts: number;
  /** The value of one part, and the asked share. */
  unit: number;
  share: number;
}

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.48, h: 0.4 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.4 },
    bar: { x: 0.04, y: 0.44, w: 0.92, h: 0.56 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 1 },
    notes: { x: 0, y: 0, w: 1, h: 1 },
    bar: { x: 0, y: 0, w: 1, h: 1 },
  },
});

const pounds = (value: number) => formatNumber(value, { pounds: true });
const partsWord = (count: number) => `${count} ${count === 1 ? "part" : "parts"}`;

/** The bottom edge of the lowest element. */
/**
 * The question as one wrapped paragraph that never breaks inside the ratio ("1 :" at the end of
 * one line and "2" on the next would be hard to read).
 */
function keepRatio(
  id: string,
  content: string,
  ratio: string,
  region: Rect,
  size: number,
): TextElement {
  // The ratio's own spaces are held back while the words are split, so it stays one word.
  const held = ratio.replaceAll(" ", "\u0000");
  const words = content
    .replace(ratio, held)
    .split(" ")
    .filter(Boolean)
    .map((word) => word.replaceAll("\u0000", " "));
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureText(candidate, size).w > region.width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return {
    id,
    role: "given",
    type: "text",
    x: region.x,
    y: region.y,
    w: Math.max(...lines.map((entry) => measureText(entry, size).w)),
    h: lines.length * LINE_HEIGHT * size,
    size,
    font: "body",
    align: "start",
    text: lines.join("\n"),
  };
}

/** Every element, by focus id, with nothing revealed yet left out: positions never shift. */
function layout(p: Params, format: SceneFormat): Record<string, SceneElement[]> {
  const size = WORKING;
  const gap = size * 0.3;
  const name = NAMES[p.ask];
  const regions = REGIONS[format];
  const textRegion = regionRect(format, regions.text);
  const out: Record<string, SceneElement[]> = {};

  out.question = [
    keepRatio(
      "question",
      `${NAMES.a} and ${NAMES.b} share ${pounds(p.total)} in the ratio ${p.a} : ${p.b}. How much does ${name} get?`,
      `${p.a} : ${p.b}`,
      textRegion,
      size,
    ),
  ];
  out.student = stack(
    [
      {
        id: "student.working",
        role: "student",
        content: `You worked out ${pounds(p.total)} ÷ ${p.asked}`,
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
        content: `${name}'s share = ${pounds(p.total)} ÷ ${p.asked}`,
      },
    ],
    notes,
    { size, spacing: gap },
  );
  const reasoning = bounds(slip[1]!);
  out.slip = [
    ...slip,
    {
      id: "slip.mark",
      role: "misconception",
      type: "mark",
      kind: "cross",
      x: reasoning.x + reasoning.width + size * 0.3,
      y: reasoning.y + reasoning.height * 0.1,
      w: size * 0.8,
      h: reasoning.height * 0.8,
    },
  ];

  // The bar: the whole amount over a + b equal parts, grouped by person underneath.
  // On mobile the bar is inset a little, so the labels at either end sit clear of the margin.
  const ringRoom = LABEL * 0.25;
  const barArea: Rect =
    format === "desktop"
      ? regionRect(format, regions.bar)
      : {
          x: textRegion.x + ringRoom,
          y: bottomOf(out.slip) + size * 0.7,
          width: textRegion.width - 2 * ringRoom,
          height: textRegion.height,
        };
  const height = LABEL * 1.9;
  const block = 2 * braceHeight(LABEL) + height;
  // On desktop the bar sits in the middle of its region; on mobile it follows the slip.
  const top =
    format === "desktop" ? barArea.y + Math.max(0, (barArea.height - block) / 2) : barArea.y;
  const model = bar({
    id: "bar",
    x: barArea.x,
    y: top + braceHeight(LABEL),
    parts: p.parts,
    partWidth: barArea.width / p.parts,
    height,
    role: "structure",
  });
  const whole = brace({
    id: "bar.total",
    role: "given",
    span: model.box,
    side: "above",
    label: pounds(p.total),
    size: LABEL,
    within: barArea,
  });
  const first = brace({
    id: "bar.first",
    role: "given",
    span: model.span(0, p.a),
    side: "below",
    label: `${NAMES.a}: ${partsWord(p.a)}`,
    size: LABEL,
    within: barArea,
  });
  const second = brace({
    id: "bar.second",
    role: "given",
    span: model.span(p.a, p.parts),
    side: "below",
    label: `${NAMES.b}: ${partsWord(p.b)}`,
    size: LABEL,
    within: barArea,
  });
  out.bar = [...model.elements, ...whole.elements, ...first.elements, ...second.elements];

  // One part's value, inside every part when it fits.
  const unit = pounds(p.unit);
  const values = fitsInPart(model, [unit], LABEL)
    ? Array.from({ length: p.parts }, (_, i) =>
        partLabel(model, i, `part.value.${i}`, "correct", unit, LABEL),
      )
    : [];
  const working =
    format === "desktop"
      ? { ...notes, y: bottomOf(out.slip) + size * 0.7 }
      : { ...textRegion, y: bottomOf(out.bar) + size * 0.5 };
  out.part = [
    ...values,
    ...stack(
      [
        {
          id: "part.working",
          role: "correct",
          content: `${pounds(p.total)} ÷ ${p.parts} = ${unit} for each part`,
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
        content: `${name} gets ${partsWord(p.asked)} × ${unit} = ${pounds(p.share)}`,
      },
    ],
    { ...working, y: bottomOf(out.part.filter((e) => e.id === "part.working")) + gap },
    { size },
  );
  const line = bounds(answer[0]!);
  const asked = p.ask === "a" ? first.label : second.label;
  const pad = LABEL * 0.2;
  out.answer = [
    ...answer,
    {
      id: "answer.mark",
      role: "correct",
      type: "mark",
      kind: "tick",
      x: line.x + line.width + size * 0.3,
      y: line.y + line.height * 0.1,
      w: size * 0.8,
      h: line.height * 0.8,
    },
    // The asked person's share, underlined in the bar (a ring would cut into a wide label).
    {
      id: "answer.underline",
      role: "correct",
      type: "mark",
      kind: "underline",
      x: asked.x,
      y: asked.y,
      w: asked.w,
      h: asked.h + pad * 0.5,
    },
  ];
  return out;
}

export const shareInRatio: SceneTemplate<Params> = {
  key: "bar_model.share_in_ratio",
  version: 1,
  primitive: "bar_model",
  node: "R5",
  misconception: "RATIO_DIVIDE_BY_EACH_PART",
  itemTemplate: "r5-share-in-ratio",
  title: "Sharing an amount in a ratio",
  focusIds: FOCUS,

  params(item) {
    const a = integer(item, "a", 1, 7);
    const b = integer(item, "b", 1, 7);
    const total = integer(item, "total", 2, 9999);
    const ask = oneOf(item, "ask", ["a", "b"] as const);
    if (a === b) throw new Error("The two numbers in the ratio must differ");
    if (total % (a + b) !== 0) throw new Error("The total must share into whole parts");
    const unit = total / (a + b);
    const asked = ask === "a" ? a : b;
    return { a, b, total, ask, asked, parts: a + b, unit, share: unit * asked };
  },

  spec(p, item, studentAnswer) {
    const name = NAMES[p.ask];
    const [total, unit] = [pounds(p.total), pounds(p.unit)];
    return {
      schema: "scene-spec/1",
      template: "bar_model.share_in_ratio@1",
      misconception: "RATIO_DIVIDE_BY_EACH_PART",
      params: item,
      studentAnswer,
      correctAnswer: p.share,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `${NAMES.a} and ${NAMES.b} share ${total} in the ratio ${p.a} to ${p.b}. How much does ${name} get?`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You divided ${total} by ${p.asked}, because ${name}'s number in the ratio is ${p.asked}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: the ${p.asked} tells you how many parts ${name} gets, not how many parts to share ${total} into.`,
        },
        {
          kind: "build",
          focus: ["bar"],
          narration: `Draw a bar with ${partsWord(p.a)} for ${NAMES.a} and ${partsWord(p.b)} for ${NAMES.b}. That is ${p.parts} equal parts in total.`,
        },
        {
          kind: "transform",
          focus: ["part"],
          narration: `${total} shared into ${p.parts} equal parts is ${unit} for each part.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `${name} gets ${partsWord(p.asked)}, each worth ${unit}. ${p.asked} times ${unit} is ${pounds(p.share)}.`,
        },
      ],
    };
  },

  draw(p, format: SceneFormat, revealed) {
    const all = layout(p, format);
    return FOCUS.flatMap((id) => (revealed.has(id) ? (all[id] ?? []) : []));
  },

  predicted(p): JsonValue {
    // The total divided by the asked person's number in the ratio.
    return ["Rational", p.total, p.asked];
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Add", p.a, p.b], p.parts],
      ["Equal", ["Divide", p.total, p.parts], p.unit],
      ["Equal", ["Multiply", p.asked, p.unit], p.share],
      ["Equal", ["Multiply", p.parts, p.unit], p.total],
    ];
  },

  sample: { item: { a: 1, b: 2, total: 42, ask: "b" }, studentAnswer: 21 },
};
