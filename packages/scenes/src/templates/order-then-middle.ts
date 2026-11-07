import type { JsonValue } from "@eddy/schemas";
import { regionRect, type SceneFormat } from "../canvas";
import { formatNumber } from "../layout/format";
import { bounds, ringRound, stack, type StackItem, text } from "../layout/geometry";
import type { MarkElement, RectElement, SceneElement } from "../layout/types";
import { cardRow } from "../primitives/data-chart";
import { integers, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** MEDIAN_UNORDERED: "the median of 20, 1, 1, 27, 16 is the middle one, 1." */

interface Params {
  /** The values as the question lists them, and in order. */
  values: number[];
  sorted: number[];
  middle: number;
  /** What the student took: the middle of the list as written. */
  unsortedMiddle: number;
  median: number;
}

const FOCUS = ["question", "cards", "student", "slip", "order", "count", "answer"] as const;

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.5, h: 0.4 },
    notes: { x: 0.54, y: 0, w: 0.46, h: 0.4 },
    cards: { x: 0, y: 0.42, w: 1, h: 0.58 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 0.42 },
    notes: { x: 0, y: 0, w: 1, h: 0.42 },
    cards: { x: 0, y: 0.44, w: 1, h: 0.56 },
  },
});

/** A pen ring round a card, clear of the cards either side. */
function ringAround(
  id: string,
  role: "student" | "correct",
  card: RectElement,
  margin: number,
): MarkElement {
  const ring = ringRound(bounds(card), margin, "down");
  return {
    id,
    role,
    type: "mark",
    kind: "ring",
    x: ring.x,
    y: ring.y,
    w: ring.width,
    h: ring.height,
  };
}

/** Every element the scene can show, in drawing order. */
function parts(p: Params, format: SceneFormat): SceneElement[] {
  const regions = REGIONS[format];
  // Larger cards where there is room for them.
  const size = format === "desktop" ? WORKING : LABEL;
  const area = regionRect(format, regions.cards);
  const cardHeight = size * (format === "desktop" ? 2 : 1.8);
  const captionGap = size * 0.3;
  const caption = text("order.caption", "correct", "In order:", area.x, 0, {
    size,
    align: "start",
    valign: "top",
  });
  // Both rows, the caption between them, centred in the area.
  const block = cardHeight + size * 1.1 + caption.h + captionGap + cardHeight;
  const top = area.y + (area.height - block) / 2;
  const maxWidth = size * 2.3;
  const given = cardRow({
    id: "cards",
    band: { x: area.x, y: top, width: area.width, height: cardHeight },
    values: p.values,
    size,
    maxWidth,
    gap: size * 0.6,
  });
  const captionY = top + cardHeight + size * 1.1;
  const sortedTop = captionY + caption.h + captionGap;
  const sorted = cardRow({
    id: "order",
    band: { x: area.x, y: sortedTop, width: area.width, height: cardHeight },
    values: p.sorted,
    size,
    maxWidth,
    gap: size * 0.6,
  });
  const placedCaption = { ...caption, x: sorted.box.x, y: captionY };

  const middleGiven = given.cards[p.middle]!.box;
  const middleSorted = sorted.cards[p.middle]!.box;
  const margin = Math.max(
    size * 0.15,
    (given.cards[1]!.box.x - middleGiven.x - middleGiven.w) * 0.45,
  );
  const studentRing = ringAround("student.ring", "student", middleGiven, margin);
  // Cross off one card from each end until one is left.
  const strikes: SceneElement[] = sorted.cards
    .filter((_, i) => i !== p.middle)
    .map((card, i) => ({
      id: `count.strike.${i}`,
      role: "structure" as const,
      type: "mark" as const,
      kind: "strike" as const,
      x: card.box.x,
      y: card.box.y,
      w: card.box.w,
      h: card.box.h,
    }));
  const answerRing = ringAround("answer.ring", "correct", middleSorted, margin);

  const lead: StackItem[] = [
    { id: "question", role: "given", content: "Find the median of these numbers." },
    {
      id: "student.text",
      role: "student",
      content: `You took the middle card: ${formatNumber(p.unsortedMiddle)}`,
    },
  ];
  const notes: StackItem[] = [
    { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
    { id: "slip.reasoning", role: "misconception", content: "middle of the list as written" },
    { id: "answer.text", role: "correct", content: `Median = ${formatNumber(p.median)}` },
  ];
  const options = { size: WORKING, spacing: WORKING * 0.35 };
  const lines =
    format === "mobile"
      ? stack([...lead, ...notes], regionRect(format, regions.text), options)
      : [
          ...stack(lead, regionRect(format, regions.text), options),
          ...stack(notes, regionRect(format, regions.notes), options),
        ];
  const reasoning = bounds(lines.find((element) => element.id === "slip.reasoning")!);
  const cross: SceneElement = {
    id: "slip.mark",
    role: "misconception",
    type: "mark",
    kind: "cross",
    x: reasoning.x + reasoning.width + WORKING * 0.3,
    y: reasoning.y + reasoning.height * 0.15,
    w: WORKING * 0.7,
    h: reasoning.height * 0.7,
  };

  return [
    ...given.elements,
    ...sorted.elements,
    placedCaption,
    studentRing,
    ...strikes,
    answerRing,
    ...lines,
    cross,
  ];
}

export const orderThenMiddle: SceneTemplate<Params> = {
  key: "data_chart.order_then_middle",
  version: 1,
  primitive: "data_chart",
  node: "S4",
  misconception: "MEDIAN_UNORDERED",
  itemTemplate: "s4-median",
  title: "Order the numbers, then find the middle",
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
    const values = integers(item, "values", 0, 99, [3, 9]);
    if (values.length % 2 === 0) throw new Error("The list must have an odd number of values");
    const sorted = [...values].sort((a, b) => a - b);
    const middle = (values.length - 1) / 2;
    if (values[middle] === sorted[middle]) {
      // The middle of the list as written is already the median: this slip cannot show here.
      throw new Error("The middle of the list as written is already the median");
    }
    return { values, sorted, middle, unsortedMiddle: values[middle]!, median: sorted[middle]! };
  },

  spec(p, item, studentAnswer) {
    const [median, took] = [formatNumber(p.median), formatNumber(p.unsortedMiddle)];
    return {
      schema: "scene-spec/1",
      template: "data_chart.order_then_middle@1",
      misconception: "MEDIAN_UNORDERED",
      params: item,
      studentAnswer,
      correctAnswer: p.median,
      beats: [
        {
          kind: "show_given",
          focus: ["question", "cards"],
          narration: "Find the median of these numbers.",
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You took the number in the middle of the list as it is written: ${took}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration:
            "A common slip: taking the middle of the list before putting the numbers in order.",
        },
        {
          kind: "build",
          focus: ["order"],
          narration: "First, put the numbers in order, from smallest to largest.",
        },
        {
          kind: "transform",
          focus: ["count"],
          narration:
            "Cross off numbers in pairs, one from each end, until one is left in the middle.",
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `The median is the middle value once the numbers are in order. Here it is ${median}.`,
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
    // The middle of the list as written.
    return p.unsortedMiddle;
  },

  claims(p): JsonValue[] {
    // The row in order really is in order, and the median sits in its middle.
    return [
      ...p.sorted.slice(1).map((value, i): JsonValue => ["LessEqual", p.sorted[i]!, value]),
      ["LessEqual", p.sorted[0]!, p.median],
      ["LessEqual", p.median, p.sorted.at(-1)!],
    ];
  },

  sample: { item: { values: [20, 1, 1, 27, 16] }, studentAnswer: 1 },
};
