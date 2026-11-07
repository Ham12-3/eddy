import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber, mathNumber } from "../layout/format";
import { paragraph, text } from "../layout/geometry";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import type { MathNode, SceneElement } from "../layout/types";
import {
  dimension,
  rectangleParts,
  rightAngle,
  triangleHalves,
  triangleInRectangle,
  trianglePoints,
} from "../primitives/area-model";
import { integer, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";
import { focusOf } from "./template";

/** AREA_TRIANGLE_NO_HALF: base 6 cm, height 7 cm, area 42 cm² (the rectangle), not 21 cm². */

interface Params {
  b: number;
  h: number;
  /** b × h, the rectangle (and the student's answer). */
  rectangle: number;
  /** b × h ÷ 2, the triangle. */
  area: number;
}

const REGIONS = layoutFor({
  desktop: { text: { x: 0, y: 0, w: 0.45, h: 1 }, shape: { x: 0.5, y: 0, w: 0.5, h: 1 } },
  // On a phone the shape takes the height the question and the notes leave between them.
  mobile: { text: { x: 0, y: 0, w: 1, h: 1 }, shape: { x: 0, y: 0, w: 1, h: 1 } },
});

/** "26 cm²" with the superscript two. */
function squareCm(value: number): string {
  return `${formatNumber(value)} cm²`;
}

/**
 * Every element of the scene, in one format; `draw` shows those whose focus id is revealed.
 * `folded` is whether the copies of the triangle's halves have made their half turn onto the
 * pieces outside it yet (the "match" beat).
 */
function layout(p: Params, format: SceneFormat, folded: boolean): SceneElement[] {
  const regions = REGIONS[format];
  const size = WORKING;
  const textRegion = regionRect(format, regions.text);
  const question = paragraph(
    "question",
    "given",
    `A triangle has base ${formatNumber(p.b)} cm and perpendicular height ${formatNumber(p.h)} cm. Work out its area.`,
    textRegion.x,
    textRegion.y,
    textRegion.width,
    { size },
  );
  const studentTop = question.y + question.h + size * 0.5;
  const student = paragraph(
    "student.text",
    "student",
    `You worked out ${formatNumber(p.b)} × ${formatNumber(p.h)} = ${squareCm(p.rectangle)}.`,
    textRegion.x,
    studentTop,
    textRegion.width,
    { size },
  );
  const studentBottom = student.y + student.h;

  if (format === "desktop") {
    const notes = slipAndAnswer(p, textRegion.x, studentBottom + size, textRegion.width);
    return [
      question,
      student,
      ...shape(p, regionRect(format, regions.shape), 2.5, folded),
      ...notes.elements,
    ];
  }
  const trial = slipAndAnswer(p, textRegion.x, 0, textRegion.width);
  const notesTop = textRegion.y + textRegion.height - trial.bottom;
  const notes = slipAndAnswer(p, textRegion.x, notesTop, textRegion.width);
  const shapeTop = studentBottom + size * 0.5;
  const space = {
    x: textRegion.x,
    y: shapeTop,
    width: textRegion.width,
    height: notesTop - size * 0.5 - shapeTop,
  };
  return [question, student, ...shape(p, space, 1.6, folded), ...notes.elements];
}

/** "A common slip: base × height", with a cross, then the area as half of base times height. */
function slipAndAnswer(
  p: Params,
  left: number,
  top: number,
  width: number,
): { elements: SceneElement[]; bottom: number } {
  const size = WORKING;
  const title = text("slip.title", "misconception", "A common slip:", left, top, {
    size,
    font: "pen",
    align: "start",
    valign: "top",
  });
  const words = "base × height";
  const beside = text(
    "slip.reasoning",
    "misconception",
    words,
    title.x + title.w + size * 0.3,
    title.y + title.h / 2,
    { size, align: "start" },
  );
  const reasoning =
    beside.x + beside.w + size * 1.3 <= left + width
      ? beside
      : text("slip.reasoning", "misconception", words, left, title.y + title.h + size * 0.1, {
          size,
          align: "start",
          valign: "top",
        });
  const mark: SceneElement = {
    id: "slip.mark",
    role: "misconception",
    type: "mark",
    kind: "cross",
    x: reasoning.x + reasoning.w + size * 0.3,
    y: reasoning.y + reasoning.h * 0.15,
    w: size * 0.7,
    h: reasoning.h * 0.7,
  };
  const half: MathNode = { frac: [[{ num: "1" }], [{ num: "2" }]] };
  const working: MathNode[] = [
    { text: "Area" },
    { op: "=" },
    half,
    { op: "×" },
    mathNumber(p.b),
    { op: "×" },
    mathNumber(p.h),
    { op: "=" },
    mathNumber(p.area),
    { pow: [[{ text: " cm" }], [{ num: "2" }]] },
  ];
  const answerTop = Math.max(title.y + title.h, reasoning.y + reasoning.h) + size * 0.4;
  const answer = text("answer.working", "correct", working, left, answerTop, {
    size,
    align: "start",
    valign: "top",
  });
  return { elements: [title, reasoning, mark, answer], bottom: answer.y + answer.h };
}

/** The triangle with its base and height, the rectangle around it and the two pieces outside it. */
function shape(p: Params, region: Rect, maxRatio: number, folded: boolean): SceneElement[] {
  const size = LABEL;
  const gap = size * 0.3;
  const labelH = LINE_HEIGHT * size;
  const tick = size * 0.25;
  const heightLabel = `${formatNumber(p.h)} cm`;
  const sideRoom = gap * 2.5 + tick + measureText(heightLabel, size).w;
  // Room above for the rectangle's label, below for the base (and "not drawn to scale"), right for the height.
  const fit = (below: number) =>
    triangleInRectangle({
      base: p.b,
      height: p.h,
      space: {
        x: region.x + sideRoom * 0.5,
        y: region.y + labelH + gap,
        width: region.width - sideRoom * 1.5,
        height: region.height - labelH - gap - below,
      },
      minRatio: 0.3,
      maxRatio,
    });
  let drawing = fit(labelH + gap);
  if (drawing.notToScale) drawing = fit(2 * (labelH + gap));
  const { left, right, top, bottom, apex, foot } = drawing;
  const middle = (left + right) / 2;
  const dimX = right + gap * 1.5;

  const elements: SceneElement[] = [
    {
      id: "shape.triangle",
      role: "given",
      type: "polygon",
      points: trianglePoints(drawing),
      fill: true,
    },
  ];
  // The two parts either side of the height, each with its half of the triangle in green.
  const [leftHalf, rightHalf] = triangleHalves(drawing);
  const inset = 6;
  // A copy of each half sits on it, then makes a half turn about the middle of its sloping side.
  // That turn takes the half exactly onto the piece outside the triangle (a half turn, not a
  // reflection: a rectangle's diagonal is not a line of symmetry unless it is a square).
  const copy = (id: string, points: number[], slope: [number, number, number, number]) => ({
    id,
    role: "correct" as const,
    type: "polygon" as const,
    points,
    fill: true,
    turn: {
      cx: (slope[0] + slope[2]) / 2,
      cy: (slope[1] + slope[3]) / 2,
      degrees: folded ? -180 : 0,
    },
  });
  elements.push(
    ...rectangleParts(drawing).map((part, i): SceneElement => ({
      id: `parts.part${i + 1}`,
      role: "correct",
      type: "rect",
      x: part.x + inset,
      y: part.y + inset,
      w: part.width - 2 * inset,
      h: part.height - 2 * inset,
    })),
    { id: "parts.leftHalf", role: "correct", type: "polygon", points: leftHalf, fill: true },
    { id: "parts.rightHalf", role: "correct", type: "polygon", points: rightHalf, fill: true },
    copy("match.left", leftHalf, [left, bottom, apex[0], apex[1]]),
    copy("match.right", rightHalf, [apex[0], apex[1], right, bottom]),
    {
      id: "shape.height",
      role: "given",
      type: "line",
      x1: apex[0],
      y1: apex[1],
      x2: foot[0],
      y2: foot[1],
      width: 3,
      dash: true,
    },
    rightAngle("shape.square", "given", drawing, size * 0.4),
    // Faint guides carry the top and bottom of the height out to the dimension line.
    {
      id: "shape.guideTop",
      role: "structure",
      layer: "background",
      type: "line",
      x1: apex[0],
      y1: top,
      x2: dimX,
      y2: top,
      width: 2,
      dash: true,
    },
    {
      id: "shape.guideBottom",
      role: "structure",
      layer: "background",
      type: "line",
      x1: right,
      y1: bottom,
      x2: dimX,
      y2: bottom,
      width: 2,
      dash: true,
    },
    ...dimension("shape.dimension", "given", dimX, top, bottom, tick),
    text("shape.heightLabel", "given", heightLabel, dimX + tick + gap, (top + bottom) / 2, {
      size,
      align: "start",
    }),
  );
  const baseLabel = text(
    "shape.baseLabel",
    "given",
    `${formatNumber(p.b)} cm`,
    middle,
    bottom + gap,
    { size, valign: "top" },
  );
  elements.push(baseLabel);
  if (drawing.notToScale) {
    elements.push(
      text(
        "shape.scale",
        "structure",
        "not drawn to scale",
        middle,
        baseLabel.y + baseLabel.h + gap * 0.5,
        { size, valign: "top" },
      ),
    );
  }
  // The rectangle the student worked out, with its area above it.
  elements.push(
    {
      id: "rectangle.outline",
      role: "student",
      type: "rect",
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    },
    text(
      "rectangle.label",
      "student",
      `${formatNumber(p.b)} × ${formatNumber(p.h)} = ${squareCm(p.rectangle)}`,
      middle,
      top - gap,
      {
        size,
        valign: "bottom",
      },
    ),
  );
  return elements;
}

export const triangleArea: SceneTemplate<Params> = {
  key: "area_model.triangle_half_rectangle",
  version: 1,
  primitive: "area_model",
  node: "G16",
  misconception: "AREA_TRIANGLE_NO_HALF",
  itemTemplate: "g16-triangle-area",
  title: "A triangle is half its rectangle",
  focusIds: ["question", "shape", "student", "rectangle", "slip", "parts", "match", "answer"],
  beatKinds: withRefocusKinds(
    "show_given",
    "show_student_working",
    "highlight_slip",
    "build",
    "transform",
    "reveal_correct",
  ),

  params(item) {
    const b = integer(item, "b", 3, 16);
    const h = integer(item, "h", 2, 14);
    return { b, h, rectangle: b * h, area: (b * h) / 2 };
  },

  spec(p, item, studentAnswer) {
    const [b, h, rectangle, area] = [p.b, p.h, p.rectangle, p.area].map((value) =>
      formatNumber(value),
    );
    return {
      schema: "scene-spec/1",
      template: "area_model.triangle_half_rectangle@1",
      misconception: "AREA_TRIANGLE_NO_HALF",
      params: item,
      studentAnswer,
      correctAnswer: Number.isInteger(p.area) ? p.area : ["Rational", p.rectangle, 2],
      beats: [
        {
          kind: "show_given",
          focus: ["question", "shape"],
          narration: `A triangle has base ${b} cm and perpendicular height ${h} cm. Work out its area.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You multiplied the base by the height: ${b} times ${h} is ${rectangle}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["rectangle", "slip"],
          narration: `Your ${rectangle} square centimetres is the area of the whole rectangle, ${b} cm by ${h} cm. A common slip is to stop there.`,
        },
        {
          kind: "build",
          focus: ["parts"],
          narration:
            "The dashed height splits the rectangle into two parts. A sloping side cuts each part into two pieces.",
        },
        {
          kind: "transform",
          focus: ["match"],
          narration:
            "Give a copy of each piece inside the triangle a half turn about the middle of its sloping side. It fits the piece outside exactly.",
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `So the triangle is exactly half the rectangle. Half of ${b} times ${h} is ${area} square centimetres.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    // The copies arrive with the parts, sitting on the halves, and turn in the next beat.
    return layout(p, format, revealed.has("match")).filter((element) =>
      revealed.has(element.id.startsWith("match.") ? "parts" : focusOf(element.id)),
    );
  },

  predicted(p) {
    // Base times height, with no half.
    return p.rectangle;
  },

  claims(p): JsonValue[] {
    const area: JsonValue = Number.isInteger(p.area) ? p.area : { num: formatNumber(p.area) };
    return [
      ["Equal", ["Multiply", p.b, p.h], p.rectangle],
      ["Equal", ["Multiply", ["Rational", 1, 2], p.b, p.h], area],
      ["Equal", ["Divide", p.rectangle, 2], area],
    ];
  },

  sample: { item: { b: 6, h: 7 }, studentAnswer: 42 },
};
