import type { JsonValue } from "@eddy/schemas";
import { regionRect, type SceneFormat } from "../canvas";
import { bounds, grow, slantedLine, stack, text } from "../layout/geometry";
import type { MathNode, SceneElement } from "../layout/types";
import { probabilityTree } from "../primitives/probability-tree";
import { gcd, integer, LABEL, layoutFor, memoise, WORKING } from "./shared";
import type { SceneTemplate } from "./template";

/** TREE_ADD_ALONG_BRANCHES: "late and rain is 3/5 + 5/8." */

interface Fraction {
  top: number;
  bottom: number;
}

interface Params {
  /** P(the bus is late) and P(it rains), as the question gives them. */
  late: Fraction;
  rain: Fraction;
  /** The student's sum, in lowest terms. */
  sum: Fraction;
  /** The product before and after simplifying. */
  product: Fraction;
  answer: Fraction;
}

const FOCUS = ["question", "tree", "student", "slip", "path", "multiply", "answer"] as const;

const REGIONS = layoutFor({
  desktop: { text: { x: 0, y: 0, w: 0.42, h: 1 }, tree: { x: 0.45, y: 0, w: 0.55, h: 1 } },
  mobile: { text: { x: 0, y: 0, w: 1, h: 0.56 }, tree: { x: 0, y: 0.59, w: 1, h: 0.41 } },
});

function simplest(top: number, bottom: number): Fraction {
  const divisor = gcd(top, bottom);
  return { top: top / divisor, bottom: bottom / divisor };
}

/** A fraction as a maths label; a whole number (a sum of exactly 1) as itself. */
const frac = ({ top, bottom }: Fraction): MathNode =>
  bottom === 1
    ? { num: String(top) }
    : { frac: [[{ num: String(top) }], [{ num: String(bottom) }]] };
const words = ({ top, bottom }: Fraction): string => (bottom === 1 ? `${top}` : `${top}/${bottom}`);
const rational = ({ top, bottom }: Fraction): JsonValue => ["Rational", top, bottom];
const complement = ({ top, bottom }: Fraction): Fraction => ({ top: bottom - top, bottom });
const simplifies = (p: Params): boolean => p.product.bottom !== p.answer.bottom;
const overOne = (p: Params): boolean => p.sum.top > p.sum.bottom;

/** Every element the scene can show, in drawing order. */
function computeParts(p: Params, format: SceneFormat): SceneElement[] {
  const regions = REGIONS[format];
  const size = LABEL;
  const tree = probabilityTree({
    id: "tree",
    region: regionRect(format, regions.tree),
    orientation: format === "desktop" ? "across" : "down",
    size,
    first: [
      { name: "late", probability: [frac(p.late)] },
      { name: "not late", probability: [frac(complement(p.late))] },
    ],
    second: [
      { name: "rain", probability: [frac(p.rain)] },
      { name: "no rain", probability: [frac(complement(p.rain))] },
    ],
  });

  // The path for late, then rain: drawn over in the corrected colour, its names highlighted.
  const path: SceneElement[] = [];
  for (const [key, id] of [
    ["first.0", "path.first"],
    ["second.0.0", "path.second"],
  ] as const) {
    const branch = tree.branch(key);
    path.push(...slantedLine(id, "correct", branch.from, branch.to, { width: 8 }));
    const name = grow(bounds(branch.name), size * 0.08);
    path.push({
      id: `${id}Name`,
      role: "highlight",
      type: "rect",
      x: name.x,
      y: name.y,
      w: name.width,
      h: name.height,
      fill: true,
    });
  }

  const lines = stack(
    [
      { id: "question.ask", role: "given", content: "Find P(late and rain)." },
      { id: "question.independent", role: "given", content: "The events are independent." },
      {
        id: "student",
        role: "student",
        content: [frac(p.late), { op: "+" }, frac(p.rain), { op: "=" }, frac(p.sum)],
      },
      { id: "slip.title", role: "misconception", content: "A common slip:", font: "pen" },
      { id: "slip.reasoning", role: "misconception", content: "adding along the branches" },
      {
        id: "multiply.working",
        role: "correct",
        content: [frac(p.late), { op: "×" }, frac(p.rain)],
      },
    ],
    regionRect(format, regions.text),
    // Fractions reach a little above their boxes: leave room over each line.
    { size: WORKING, spacing: WORKING * 0.22 },
  );
  const find = (id: string) => bounds(lines.find((element) => element.id === id)!);
  // In the path beat, the reason to multiply: the events are independent.
  // Grown up and down only: the line starts at the safe margin.
  const line = find("question.independent");
  const independent = { ...line, y: line.y - size * 0.08, height: line.height + size * 0.16 };
  const reason: SceneElement = {
    id: "path.reason",
    role: "highlight",
    type: "rect",
    x: independent.x,
    y: independent.y,
    w: independent.width,
    h: independent.height,
    fill: true,
  };
  const reasoning = find("slip.reasoning");
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

  // Then "= product" and, when it simplifies, "= answer": each piece its own label, laid side by
  // side, so every gap is set here and the ring goes round a whole label. A lone "=" is centred
  // in its box, which leaves an even space either side of it.
  const working = find("multiply.working");
  const centreY = working.y + working.height / 2;
  const after = (id: string, content: MathNode[], left: number, align: "start" | "middle") => ({
    ...text(id, "correct", content, 0, centreY, { size: WORKING, align }),
    x: left,
  });
  const productEquals = after(
    "multiply.equals",
    [{ op: "=" }],
    working.x + working.width + 1,
    "middle",
  );
  const product = after(
    "multiply.product",
    [frac(p.product)],
    productEquals.x + productEquals.w + WORKING * 0.15,
    "middle",
  );
  const answer: SceneElement[] = [productEquals, product];
  let ringed = bounds(product);
  if (simplifies(p)) {
    const answerEquals = after("answer.equals", [{ op: "=" }], product.x + product.w + 1, "middle");
    const value = after(
      "answer.value",
      [frac(p.answer)],
      answerEquals.x + answerEquals.w + WORKING * 0.15,
      "middle",
    );
    answer.push(answerEquals, value);
    ringed = bounds(value);
  }
  // A fraction's glyphs leave its box's corners empty, so a plain margin clears them.
  const ring = {
    x: ringed.x - WORKING * 0.12,
    y: ringed.y - WORKING * 0.22,
    width: ringed.width + WORKING * 0.24,
    height: ringed.height + WORKING * 0.44,
  };
  answer.push({
    id: "answer.ring",
    role: "correct",
    type: "mark",
    kind: "ring",
    x: ring.x,
    y: ring.y,
    w: ring.width,
    h: ring.height,
  });

  // The path goes over the branches it follows.
  return [...tree.elements, ...path, reason, ...lines, cross, ...answer];
}

/** The geometry is the same for every beat: work it out once per scene and format. */
const partsCache = memoise((key) => {
  const [p, format] = JSON.parse(key) as Parameters<typeof computeParts>;
  return computeParts(p, format);
});
function parts(p: Params, format: SceneFormat): SceneElement[] {
  return partsCache(JSON.stringify([p, format]));
}

export const multiplyAlong: SceneTemplate<Params> = {
  key: "probability_tree.multiply_along",
  version: 1,
  primitive: "probability_tree",
  node: "P8",
  misconception: "TREE_ADD_ALONG_BRANCHES",
  itemTemplate: "p8-tree-and",
  title: "Multiply along the branches",
  focusIds: FOCUS,

  params(item) {
    const n = integer(item, "n", 2, 20);
    const m = integer(item, "m", 2, 20);
    const a = integer(item, "a", 1, n - 1);
    const b = integer(item, "b", 1, m - 1);
    return {
      late: { top: a, bottom: n },
      rain: { top: b, bottom: m },
      sum: simplest(a * m + b * n, n * m),
      product: { top: a * b, bottom: n * m },
      answer: simplest(a * b, n * m),
    };
  },

  spec(p, item, studentAnswer) {
    const [late, rain, sum, product, answer] = [p.late, p.rain, p.sum, p.product, p.answer].map(
      words,
    );
    return {
      schema: "scene-spec/1",
      template: "probability_tree.multiply_along@1",
      misconception: "TREE_ADD_ALONG_BRANCHES",
      params: item,
      studentAnswer,
      correctAnswer: rational(p.answer),
      beats: [
        {
          kind: "show_given",
          focus: ["question", "tree"],
          narration: `The bus is late with probability ${late}. It rains with probability ${rain}. The events are independent. Find the probability of both.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You added along the branches: ${late} plus ${rain} makes ${sum}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration: overOne(p)
            ? `A common slip: adding along the branches. ${sum} is more than 1, and a probability is never more than 1.`
            : late === rain
              ? `A common slip: adding along the branches. ${sum} is more than ${late}. Both happening must be less likely than either one.`
              : `A common slip: adding along the branches. ${sum} is more than ${late} and more than ${rain}. Both happening must be less likely than either one.`,
        },
        {
          kind: "build",
          focus: ["path"],
          narration:
            "Follow the path: late, then rain. The events are independent, so multiply along the path.",
        },
        {
          kind: "transform",
          focus: ["multiply"],
          narration: `Multiply the numerators, then the denominators: ${late} times ${rain} is ${product}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: simplifies(p)
            ? `That simplifies to ${answer}. The probability that the bus is late and it rains is ${answer}.`
            : `So the probability that the bus is late and it rains is ${answer}.`,
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
    // Adding along the branches: the student's sum.
    return rational(p.sum);
  },

  claims(p): JsonValue[] {
    const [late, rain] = [rational(p.late), rational(p.rain)];
    const product = ["Multiply", late, rain];
    return [
      ["Equal", ["Subtract", 1, late], rational(complement(p.late))],
      ["Equal", ["Subtract", 1, rain], rational(complement(p.rain))],
      ["Equal", ["Add", late, rain], rational(p.sum)],
      ["Greater", rational(p.sum), late],
      ["Greater", rational(p.sum), rain],
      overOne(p) ? ["Greater", rational(p.sum), 1] : ["LessEqual", rational(p.sum), 1],
      ["Equal", product, rational(p.product)],
      ["Equal", rational(p.product), rational(p.answer)],
      ["Less", product, late],
      ["Less", product, rain],
    ];
  },

  sample: { item: { n: 5, m: 8, a: 3, b: 5 }, studentAnswer: ["Rational", 49, 40] },
};
