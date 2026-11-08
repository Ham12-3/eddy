import type { JsonValue } from "@eddy/schemas";
import { regionRect, type SceneFormat } from "../canvas";
import { bounds, ringRound, slantedLine, stack } from "../layout/geometry";
import { MINUS } from "../layout/format";
import type { SceneElement } from "../layout/types";
import { angleArc, angleLabel, parallelLines } from "../primitives/angle-diagram";
import { integer, LABEL, layoutFor, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** ANGLES_COINTERIOR_EQUAL: "p and q are both between the parallel lines, so q = p." */

interface Params {
  /** Angle p, given, in degrees. */
  p: number;
  /** Angle q = 180 - p, the answer. */
  q: number;
}

const REGIONS = layoutFor({
  desktop: { text: { x: 0, y: 0, w: 0.44, h: 1 }, diagram: { x: 0.48, y: 0, w: 0.52, h: 1 } },
  mobile: { text: { x: 0, y: 0, w: 1, h: 0.55 }, diagram: { x: 0, y: 0.57, w: 1, h: 0.43 } },
});

const FOCUS = [
  "question",
  "diagram",
  "student",
  "slip",
  "alternate",
  "straight",
  "answer",
] as const;

/** Within 10° of a right angle, p and q look almost equal in the drawing. */
const nearlyRight = (p: Params): boolean => Math.abs(p.p - 90) < 10;

// Body text with the degree sign: its metrics are exact, where KaTeX's raised circle runs tall.
const degrees = (value: number): string => `${value}°`;

/** Every element the scene can show, keyed by element id, in drawing order. */
function parts(p: Params, format: SceneFormat): SceneElement[] {
  const regions = REGIONS[format];
  const size = LABEL;
  const diagramRegion = regionRect(format, regions.diagram);
  // Drawn close to scale; very shallow crossings are steepened a little so labels fit.
  const slope = Math.min(140, Math.max(40, 180 - p.p));
  // The arrow marks sit on the stretches the Z shape leaves bare.
  const lines = parallelLines({
    id: "diagram",
    region: diagramRegion,
    slope,
    size,
    marks: { top: "left", bottom: "right" },
  });
  const { top, bottom, down } = lines;
  const r = size * 1.1;

  const arcs = [
    angleArc("diagram.arcP", "given", top, down, 360, r),
    angleArc("diagram.arcQ", "given", bottom, 0, slope, r),
    angleArc("alternate.arc", "correct", bottom, slope, 180, r),
  ];
  // The Z shape: along the top line from p, down the crossing line, back along the bottom line.
  const reach = Math.min(
    diagramRegion.width * 0.22,
    size * 4,
    lines.right - top.x - 8,
    bottom.x - lines.left - 8,
  );
  const zShape = [
    {
      id: "alternate.zTop",
      role: "correct" as const,
      type: "line" as const,
      x1: top.x,
      y1: top.y,
      x2: top.x + reach,
      y2: top.y,
      width: 7,
    },
    ...slantedLine("alternate.zCross", "correct", top, bottom, { width: 7 }),
    {
      id: "alternate.zBottom",
      role: "correct" as const,
      type: "line" as const,
      x1: bottom.x - reach,
      y1: bottom.y,
      x2: bottom.x,
      y2: bottom.y,
      width: 7,
    },
  ];
  const shapes: SceneElement[] = [...lines.elements, ...arcs, ...zShape];
  const avoid = shapes.map(bounds);
  const options = { size, start: r, within: diagramRegion, avoid };

  const labelP = angleLabel(
    "diagram.labelP",
    "given",
    `p = ${degrees(p.p)}`,
    top,
    down,
    360,
    options,
  );
  const labelQ = angleLabel("diagram.labelQ", "given", "q", bottom, 0, slope, {
    ...options,
    avoid: [...avoid, bounds(labelP)],
  });
  const labelAlt = angleLabel("alternate.label", "correct", degrees(p.p), bottom, slope, 180, {
    ...options,
    avoid: [...avoid, bounds(labelP), bounds(labelQ)],
  });
  // q's size replaces its letter once it is worked out.
  const labelQSize = angleLabel(
    "straight.labelQ",
    "correct",
    `q = ${degrees(p.q)}`,
    bottom,
    0,
    slope,
    {
      ...options,
      avoid: [...avoid, bounds(labelP), bounds(labelAlt)],
      // Room for the answer's ring around it.
      gap: size * 0.4,
    },
  );

  const text = stack(
    [
      // One line on a phone; two on the narrower desktop column, so "q." never sits alone.
      ...(format === "mobile"
        ? [
            {
              id: "question.given",
              role: "given" as const,
              content: `Angle p is ${p.p}°. Work out angle q.`,
            },
          ]
        : [
            { id: "question.given", role: "given" as const, content: `Angle p is ${p.p}°.` },
            { id: "question.ask", role: "given" as const, content: "Work out angle q." },
          ]),
      { id: "student", role: "student", content: `You said q = ${p.p}°` },
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      {
        id: "slip.reasoning",
        role: "misconception",
        content: `q = p = ${degrees(p.p)}`,
      },
      { id: "alternate.reason", role: "correct", content: "Alternate angles are equal" },
      {
        id: "straight.working",
        role: "correct",
        content: `q = ${degrees(180)} ${MINUS} ${degrees(p.p)} = ${degrees(p.q)}`,
      },
      {
        id: "answer.text",
        role: "correct",
        content: `p + q = ${degrees(180)}`,
      },
    ],
    regionRect(format, regions.text),
    { size: WORKING, spacing: WORKING * 0.3 },
  );
  const reasoning = bounds(text.find((element) => element.id === "slip.reasoning")!);
  const cross = {
    id: "slip.mark",
    role: "misconception" as const,
    type: "mark" as const,
    kind: "cross" as const,
    x: reasoning.x + reasoning.width + WORKING * 0.3,
    y: reasoning.y + reasoning.height * 0.15,
    w: WORKING * 0.7,
    h: reasoning.height * 0.7,
  };
  const ring = ringRound(bounds(labelQSize), size * 0.3, "across");
  const answerRing = {
    id: "answer.ring",
    role: "correct" as const,
    type: "mark" as const,
    kind: "ring" as const,
    x: ring.x,
    y: ring.y,
    w: ring.width,
    h: ring.height,
  };

  return [...shapes, labelP, labelQ, labelAlt, labelQSize, ...text, cross, answerRing];
}

export const cointeriorAngles: SceneTemplate<Params> = {
  key: "angle_diagram.parallel_lines",
  version: 1,
  primitive: "angle_diagram",
  node: "G3",
  misconception: "ANGLES_COINTERIOR_EQUAL",
  itemTemplate: "g3-cointerior",
  title: "Co-interior angles add to 180°",
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
    const a = integer(item, "a", 1, 179);
    if (a === 90)
      throw new Error("Co-interior angles of 90° are equal; there is no slip to explain");
    return { p: a, q: 180 - a };
  },

  spec(p, item, studentAnswer) {
    return {
      schema: "scene-spec/1",
      template: "angle_diagram.parallel_lines@1",
      misconception: "ANGLES_COINTERIOR_EQUAL",
      params: item,
      studentAnswer,
      correctAnswer: p.q,
      beats: [
        {
          kind: "show_given",
          focus: ["question", "diagram"],
          narration: `Angles p and q sit between the parallel lines, on the same side. Angle p is ${p.p}°. What is angle q?`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You said q is ${p.p}°, the same as p.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          // Near 90° the drawing shows them almost equal: say so rather than contradict it.
          narration: nearlyRight(p)
            ? "A common slip: p and q look almost the same here, but they are not equal. They are co-interior: between the lines, same side."
            : "A common slip: p and q are not equal here. They are co-interior: between the lines, on the same side.",
        },
        {
          kind: "build",
          focus: ["alternate"],
          narration: `The angle next to q and angle p are alternate angles (a Z shape). Alternate angles are equal, so it is also ${p.p}°.`,
        },
        {
          kind: "transform",
          focus: ["straight"],
          narration: `Angles on a straight line add up to 180°. So q is 180° minus ${p.p}°, which is ${p.q}°.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `Co-interior angles add to 180°. So q is ${p.q}°, not ${p.p}°.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    const all = parts(p, format);
    return all.filter((element) => {
      // The letter q gives way to q's size once that is worked out.
      if (element.id === "diagram.labelQ" && revealed.has("straight")) return false;
      const focus = FOCUS.find((id) => element.id === id || element.id.startsWith(`${id}.`));
      return focus !== undefined && revealed.has(focus);
    });
  },

  predicted(p) {
    // Co-interior angles taken as equal: q = p.
    return p.p;
  },

  claims(p): JsonValue[] {
    return [
      ["Equal", ["Subtract", 180, p.p], p.q],
      ["Equal", ["Add", p.p, p.q], 180],
      ["NotEqual", p.p, p.q],
    ];
  },

  sample: { item: { a: 116 }, studentAnswer: 116 },
};
