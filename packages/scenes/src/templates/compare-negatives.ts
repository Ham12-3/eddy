import type { JsonValue } from "@eddy/schemas";
import { regionRect, type SceneFormat } from "../canvas";
import { formatNumber } from "../layout/format";
import { bounds, stack, text } from "../layout/geometry";
import type { SceneElement } from "../layout/types";
import { numberLine, pointsOn } from "../primitives/number-line";
import { integer, LABEL, layoutFor, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** NEG_ORDER_BY_DIGIT: "6 is smaller than 13, so −6 is smaller than −13." */

interface Params {
  /** The numbers as the question gives them, both negative. */
  first: number;
  second: number;
  smaller: number;
  larger: number;
}

const REGIONS = layoutFor({
  desktop: {
    text: { x: 0, y: 0, w: 0.48, h: 0.5 },
    notes: { x: 0.52, y: 0, w: 0.48, h: 0.5 },
    line: { x: 0, y: 0.56, w: 1, h: 0.44 },
  },
  mobile: {
    text: { x: 0, y: 0, w: 1, h: 0.26 },
    notes: { x: 0, y: 0.27, w: 1, h: 0.33 },
    line: { x: 0, y: 0.62, w: 1, h: 0.38 },
  },
});

export const compareNegatives: SceneTemplate<Params> = {
  key: "number_line.compare_negatives",
  version: 1,
  primitive: "number_line",
  node: "N1",
  misconception: "NEG_ORDER_BY_DIGIT",
  itemTemplate: "n1-order-negatives",
  title: "Which negative number is smaller",
  focusIds: ["question", "student", "line", "slip", "answer"],

  params(item) {
    const a = integer(item, "a", 1, 50);
    const b = integer(item, "b", 1, 50);
    if (a === b) throw new Error("The two numbers must differ");
    return { first: -a, second: -b, smaller: -Math.max(a, b), larger: -Math.min(a, b) };
  },

  spec(p, item, studentAnswer) {
    const [smaller, larger] = [formatNumber(p.smaller), formatNumber(p.larger)];
    const [bigDigit, smallDigit] = [formatNumber(-p.smaller), formatNumber(-p.larger)];
    return {
      schema: "scene-spec/1",
      template: "number_line.compare_negatives@1",
      misconception: "NEG_ORDER_BY_DIGIT",
      params: item,
      studentAnswer,
      correctAnswer: p.smaller,
      beats: [
        {
          kind: "show_given",
          focus: ["question"],
          narration: `Which is smaller: ${formatNumber(p.first)} or ${formatNumber(p.second)}?`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You chose ${larger}, because ${smallDigit} is smaller than ${bigDigit}.`,
        },
        {
          kind: "build",
          focus: ["line"],
          narration: `Put both numbers on a number line. Numbers get bigger as you go right, and smaller as you go left.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `${smallDigit} is smaller than ${bigDigit}, but ${larger} is to the right of ${smaller}. That makes ${larger} the bigger number.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `${smaller} is further left, so ${smaller} is the smaller number.`,
        },
      ],
    };
  },

  draw(p, format: SceneFormat, revealed) {
    const regions = REGIONS[format];
    const size = WORKING;
    const elements: SceneElement[] = [];
    const [smaller, larger] = [formatNumber(p.smaller), formatNumber(p.larger)];

    if (revealed.has("question")) {
      elements.push(
        ...stack(
          [
            {
              id: "question",
              role: "given",
              content: `Which is smaller: ${formatNumber(p.first)} or ${formatNumber(p.second)}?`,
            },
          ],
          regionRect(format, regions.text),
          { size },
        ),
      );
    }
    const textRegion = regionRect(format, regions.text);
    const below = elements.length
      ? bounds(elements[elements.length - 1]!).y +
        bounds(elements[elements.length - 1]!).height +
        size * 0.4
      : textRegion.y;
    if (revealed.has("student")) {
      elements.push(
        ...stack(
          [{ id: "student.choice", role: "student", content: `You chose ${larger}` }],
          { ...textRegion, y: below },
          { size },
        ),
      );
    }

    const lo = -Math.ceil((-p.smaller + 1) / 5) * 5;
    const line = numberLine({
      id: "line",
      region: regionRect(format, regions.line),
      min: lo,
      max: 5,
      tick: 1,
      labelEvery: 5,
      size: LABEL,
      at: 0.55,
    });
    if (revealed.has("line")) {
      elements.push(...line.elements);
      // A direction cue under the scale: bigger to the right, smaller to the left.
      const cueY = line.box.y + line.box.height + LABEL * 0.5;
      const ends = [line.x(lo), line.x(5)] as const;
      const smallerCue = text(
        "line.cue.smaller",
        "structure",
        "smaller",
        ends[0] + LABEL * 1.5,
        cueY,
        {
          size: LABEL,
          align: "start",
          valign: "top",
        },
      );
      const biggerCue = text(
        "line.cue.bigger",
        "structure",
        "bigger",
        ends[1] - LABEL * 1.5,
        cueY,
        {
          size: LABEL,
          align: "end",
          valign: "top",
        },
      );
      const arrowY = cueY + smallerCue.h / 2;
      elements.push(
        smallerCue,
        biggerCue,
        {
          id: "line.cue.left",
          role: "structure",
          type: "line",
          x1: ends[0] + LABEL * 0.8,
          y1: arrowY,
          x2: ends[0],
          y2: arrowY,
          width: 3,
          arrow: true,
        },
        {
          id: "line.cue.right",
          role: "structure",
          type: "line",
          x1: ends[1] - LABEL * 0.8,
          y1: arrowY,
          x2: ends[1],
          y2: arrowY,
          width: 3,
          arrow: true,
        },
      );
      elements.push(
        ...pointsOn(
          line,
          [
            { id: "line.smaller", value: p.smaller, role: "given" },
            { id: "line.larger", value: p.larger, role: "student" },
          ],
          size,
        ),
      );
    }

    if (revealed.has("slip")) {
      const notes = regionRect(format, regions.notes);
      const lines = stack(
        [
          { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
          {
            id: "slip.reasoning",
            role: "misconception",
            content: `${formatNumber(-p.larger)} < ${formatNumber(-p.smaller)}, so ${larger} < ${smaller}`,
          },
        ],
        notes,
        { size },
      );
      elements.push(...lines);
      const reasoning = bounds(lines[1]!);
      elements.push({
        id: "slip.mark",
        role: "misconception",
        type: "mark",
        kind: "cross",
        x: reasoning.x + reasoning.width + size * 0.3,
        y: reasoning.y + reasoning.height * 0.1,
        w: size * 0.8,
        h: reasoning.height * 0.8,
      });
    }

    if (revealed.has("answer")) {
      const r = size * 0.75;
      elements.push({
        id: "answer.ring",
        role: "correct",
        type: "mark",
        kind: "ring",
        x: line.x(p.smaller) - r,
        y: line.y - r,
        w: 2 * r,
        h: 2 * r,
      });
      const notes = regionRect(format, regions.notes);
      const slipBottom = revealed.has("slip")
        ? Math.max(
            ...elements
              .filter((e) => e.id.startsWith("slip."))
              .map((e) => bounds(e).y + bounds(e).height),
          )
        : notes.y;
      elements.push(
        ...stack(
          [
            {
              id: "answer.text",
              role: "correct",
              content: `${smaller} < ${larger}, so ${smaller} is smaller`,
            },
          ],
          { ...notes, y: slipBottom + size * 0.4 },
          { size },
        ),
      );
    }
    return elements;
  },

  predicted(p) {
    return p.larger;
  },

  claims(p): JsonValue[] {
    return [
      ["Less", p.smaller, p.larger],
      ["Less", -p.larger, -p.smaller],
      ["Less", p.smaller, 0],
      ["Less", p.larger, 0],
    ];
  },

  sample: { item: { a: 13, b: 6 }, studentAnswer: -6 },
};
