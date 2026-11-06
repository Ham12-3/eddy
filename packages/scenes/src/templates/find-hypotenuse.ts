import type { JsonValue } from "@eddy/schemas";
import { regionRect, type SceneFormat } from "../canvas";
import { bounds, contains, grow, paragraph, ringRound, stack, text } from "../layout/geometry";
import { measureText } from "../layout/measure";
import type { RectElement, SceneElement, TextElement } from "../layout/types";
import { labelInHypSquare, pythagorasFigure } from "../primitives/pythagoras-squares";
import { integer, LABEL, layoutFor, memoise, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** PYTH_NO_SQUARE_ROOT: "15² + 8² = 289, so the hypotenuse is 289 cm." */

interface Params {
  /** The shorter sides, in cm, as the question gives them. */
  a: number;
  b: number;
  /** The hypotenuse, in cm. */
  c: number;
}

const FOCUS = ["question", "triangle", "student", "squares", "slip", "root", "answer"] as const;

const REGIONS = layoutFor({
  desktop: { text: { x: 0, y: 0, w: 0.42, h: 1 }, diagram: { x: 0.45, y: 0, w: 0.55, h: 1 } },
  mobile: { text: { x: 0, y: 0, w: 1, h: 0.46 }, diagram: { x: 0, y: 0.48, w: 1, h: 0.52 } },
});

/** Every element the scene can show, in drawing order. */
function computeParts(p: Params, format: SceneFormat, squaresShown: boolean): SceneElement[] {
  const regions = REGIONS[format];
  const size = LABEL;
  const gap = size * 0.3;
  const region = regionRect(format, regions.diagram);
  const sideLabel = (side: number) => `${side} cm`;
  const labelWidth = Math.max(
    measureText(sideLabel(p.a), size).w,
    measureText(sideLabel(p.b), size).w,
  );
  const figure = pythagorasFigure({
    triangleId: "triangle",
    squaresId: "squares",
    region,
    a: p.a,
    b: p.b,
    size,
    labelWidth,
  });
  const { corner, acrossEnd, upEnd, squareAcross, squareUp, squareHyp } = figure;

  // Side lengths sit beside the triangle, then move out past the squares when those are drawn.
  const labelAcross = squaresShown
    ? text(
        "triangle.labelAcross",
        "given",
        sideLabel(figure.across),
        acrossEnd.x + gap,
        corner.y + squareAcross.h / 2,
        { size, align: "start" },
      )
    : text(
        "triangle.labelAcross",
        "given",
        sideLabel(figure.across),
        (corner.x + acrossEnd.x) / 2,
        corner.y + gap,
        { size, valign: "top" },
      );
  const upX = squaresShown ? squareUp.x - gap : corner.x - gap;
  const labelUp = text(
    "triangle.labelUp",
    "given",
    sideLabel(figure.up),
    upX,
    (corner.y + upEnd.y) / 2,
    { size, align: "end" },
  );

  // Areas carry their units. Inside the square on one line if it fits, else on two lines, else
  // just outside it in the space the figure leaves free: left of the square across (under the
  // square up), or above the square up.
  const areaText = (value: number) => `${value * value} cm²`;
  const twoLines = (id: string, value: number): TextElement =>
    paragraph(id, "given", areaText(value), 0, 0, 1, { size, align: "middle" });
  const fitsIn = (label: TextElement, square: RectElement) =>
    contains(grow(bounds(square), -size * 0.1), bounds(label));
  const areaOf = (
    id: string,
    value: number,
    square: RectElement,
    outside: "left" | "above",
  ): TextElement => {
    const [cx, cy] = [square.x + square.w / 2, square.y + square.h / 2];
    const oneLine = text(id, "given", areaText(value), cx, cy, { size, inside: square.id });
    if (fitsIn(oneLine, square)) return oneLine;
    const stacked = twoLines(id, value);
    const centred = { ...stacked, x: cx - stacked.w / 2, y: cy - stacked.h / 2, inside: square.id };
    if (fitsIn(centred, square)) return centred;
    return outside === "left"
      ? text(id, "given", areaText(value), square.x - gap, cy, { size, align: "end" })
      : (() => {
          // Above the square, but never past its right edge, where the big square begins.
          const above = text(id, "given", areaText(value), cx, square.y - gap, {
            size,
            valign: "bottom",
          });
          return { ...above, x: Math.min(above.x, square.x + square.w - above.w - gap / 2) };
        })();
  };
  const areaAcross = areaOf("squares.areaAcross", figure.across, squareAcross, "left");
  const areaUp = areaOf("squares.areaUp", figure.up, squareUp, "above");

  // Inside the big square: its area in the middle, or as near the middle as leaves room for the
  // hypotenuse's length beside the side (with space for the answer's ring round it).
  const overlay = figure.hypotenuse("root.hypotenuse", "correct", 8);
  const placeInSquare = (out: number, content: string | TextElement) => {
    const area = labelInHypSquare(figure, "squares.areaHyp", "given", content, {
      size,
      target: { along: 0.5, out },
      avoid: overlay.map(bounds),
      margin: size * 0.15,
    });
    const side = labelInHypSquare(figure, "root.label", "correct", `${p.c} cm`, {
      size,
      target: { along: 0.5, out: 0 },
      avoid: [...overlay.map(bounds), ...(area ? [grow(bounds(area), size * 0.25)] : [])],
      margin: size * 0.15,
    });
    return { area, side };
  };
  const placings = [areaText(p.c), twoLines("squares.areaHyp", p.c)].flatMap((content) =>
    [0.5, 0.6, 0.7, 0.8].map((out) => () => placeInSquare(out, content)),
  );
  let placed = placeInSquare(0.5, areaText(p.c));
  for (const place of placings) {
    const attempt = place();
    if (attempt.area && attempt.side) {
      placed = attempt;
      break;
    }
  }
  const { area: areaHyp, side: length } = placed;
  // Until its length is found, the hypotenuse carries a question mark beside it.
  const unknownSpot = labelInHypSquare(figure, "triangle.unknown", "given", "?", {
    size,
    target: { along: 0.5, out: 0 },
    avoid: [...overlay.map(bounds), ...(areaHyp ? [grow(bounds(areaHyp), size * 0.25)] : [])],
    margin: size * 0.15,
  });
  // It sits inside the big square only once that square is drawn.
  const unknown =
    unknownSpot &&
    text(
      "triangle.unknown",
      "given",
      "?",
      unknownSpot.x + unknownSpot.w / 2,
      unknownSpot.y + unknownSpot.h / 2,
      {
        size,
        ...(squaresShown ? { inside: squareHyp.id } : {}),
      },
    );

  const lines = stack(
    [
      { id: "question", role: "given", content: "Work out the length of the hypotenuse." },
      // Body text: its superscript two is measured exactly, where KaTeX's power runs a little tall.
      { id: "student", role: "student", content: `${p.a}² + ${p.b}² = ${p.c * p.c}` },
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      { id: "slip.reasoning", role: "misconception", content: `hypotenuse = ${p.c * p.c} cm` },
      {
        id: "root.working",
        role: "correct",
        content: [{ sqrt: [{ num: String(p.c * p.c) }] }, { op: "=" }, { num: String(p.c) }],
      },
      // On a phone the answer shares the square root's row, leaving the figure more height.
      ...(format === "desktop"
        ? [{ id: "answer.text", role: "correct" as const, content: `The hypotenuse is ${p.c} cm` }]
        : []),
    ],
    regionRect(format, regions.text),
    { size: WORKING, spacing: WORKING * 0.3 },
  );
  if (format === "mobile") {
    const root = bounds(lines.find((element) => element.id === "root.working")!);
    lines.push(
      text(
        "answer.text",
        "correct",
        `Hypotenuse = ${p.c} cm`,
        root.x + root.width + WORKING,
        root.y + root.height / 2,
        {
          size: WORKING,
          align: "start",
        },
      ),
    );
  }
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
  const ringBox = length ? ringRound(bounds(length), size * 0.2, "across") : undefined;
  const ring: SceneElement[] = ringBox
    ? [
        {
          id: "answer.ring",
          role: "correct",
          type: "mark",
          kind: "ring",
          x: ringBox.x,
          y: ringBox.y,
          w: ringBox.width,
          h: ringBox.height,
        },
      ]
    : [];

  return [
    squareAcross,
    squareUp,
    squareHyp,
    ...figure.triangle,
    labelAcross,
    labelUp,
    areaAcross,
    areaUp,
    ...(areaHyp ? [areaHyp] : []),
    ...(unknown ? [unknown] : []),
    ...overlay,
    ...(length ? [length] : []),
    ...lines,
    cross,
    ...ring,
  ];
}

/** The geometry is the same for every beat: work it out once per scene and format. */
const partsCache = memoise((key) => {
  const [p, format, squaresShown] = JSON.parse(key) as Parameters<typeof computeParts>;
  return computeParts(p, format, squaresShown);
});
function parts(p: Params, format: SceneFormat, squaresShown: boolean): SceneElement[] {
  return partsCache(JSON.stringify([p, format, squaresShown]));
}

export const findHypotenuse: SceneTemplate<Params> = {
  key: "pythagoras_squares.find_hypotenuse",
  version: 1,
  primitive: "pythagoras_squares",
  node: "G20",
  misconception: "PYTH_NO_SQUARE_ROOT",
  itemTemplate: "g20-hypotenuse",
  title: "The hypotenuse is a square root",
  focusIds: FOCUS,

  params(item) {
    const a = integer(item, "a", 1, 100);
    const b = integer(item, "b", 1, 100);
    const c = integer(item, "c", 1, 150);
    if (a * a + b * b !== c * c) throw new Error("The sides must make a right-angled triangle");
    return { a, b, c };
  },

  spec(p, item, studentAnswer) {
    const big = p.c * p.c;
    return {
      schema: "scene-spec/1",
      template: "pythagoras_squares.find_hypotenuse@1",
      misconception: "PYTH_NO_SQUARE_ROOT",
      params: item,
      studentAnswer,
      correctAnswer: p.c,
      beats: [
        {
          kind: "show_given",
          focus: ["question", "triangle"],
          narration: `A right-angled triangle has shorter sides of ${p.a} cm and ${p.b} cm. Work out the length of the hypotenuse.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You squared and added: ${p.a} squared plus ${p.b} squared is ${big}. Then you gave ${big} cm as the length.`,
        },
        {
          kind: "build",
          focus: ["squares"],
          narration: `Draw squares on the sides. Together, the small squares, ${p.a * p.a} cm² and ${p.b * p.b} cm², have the same area as the big one: ${big} cm².`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: `A common slip: ${big} cm² is the area of the big square, not the length of its side.`,
        },
        {
          kind: "transform",
          focus: ["root"],
          narration: `The hypotenuse is one side of the big square. Its length is the square root of ${big}, which is ${p.c} cm.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `Square, add, then take the square root. The hypotenuse is ${p.c} cm.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    return parts(p, format, revealed.has("squares")).filter((element) => {
      if (element.id === "triangle.unknown" && revealed.has("root")) return false;
      const focus = FOCUS.find((id) => element.id === id || element.id.startsWith(`${id}.`));
      return focus !== undefined && revealed.has(focus);
    });
  },

  predicted(p) {
    // Squared and added, but no square root: c².
    return p.c * p.c;
  },

  claims(p): JsonValue[] {
    const big = p.c * p.c;
    return [
      ["Equal", ["Power", p.a, 2], p.a * p.a],
      ["Equal", ["Power", p.b, 2], p.b * p.b],
      ["Equal", ["Add", ["Power", p.a, 2], ["Power", p.b, 2]], big],
      ["Equal", ["Power", p.c, 2], big],
      ["Equal", ["Sqrt", big], p.c],
      ["Less", p.c, big],
    ];
  },

  sample: { item: { a: 15, b: 8, c: 17 }, studentAnswer: 289 },
};
