import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber, mathNumber } from "../layout/format";
import { bounds, segmentedLine, stack, text } from "../layout/geometry";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import type { MathNode, SceneElement, TextElement } from "../layout/types";
import {
  clearOf,
  coordinateGrid,
  coordinates,
  distance,
  dot,
  lineThrough,
  labelFits,
  placeLabel,
  spotsAround,
  spotsBeside,
  type Direction,
  type Spot,
} from "../primitives/coordinate-grid";
import { gcd, integer, LABEL, layoutFor, upOrDown, WORKING } from "./shared";
import type { SceneTemplate } from "./template";
import { focusOf } from "./template";

/** GRADIENT_RUN_OVER_RISE: the line through (1, 6) and (4, 21) has gradient 3/15 = 1/5, not 5. */

interface Params {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  m: number;
  /** Across from the first point to the second: always positive. */
  run: number;
  /** Up from the first point to the second: negative when the line goes down. */
  rise: number;
}

const REGIONS = layoutFor({
  desktop: { text: { x: 0, y: 0, w: 0.45, h: 1 }, grid: { x: 0.48, y: 0, w: 0.52, h: 1 } },
  // On a phone the grid takes the height the question and the notes leave between them.
  mobile: { text: { x: 0, y: 0, w: 1, h: 1 }, grid: { x: 0, y: 0, w: 1, h: 1 } },
});

/** A fraction as a maths label in lowest terms, sign in front: −1/2. */
function fraction(numerator: number, denominator: number): MathNode[] {
  const divisor = gcd(numerator, denominator);
  const [top, bottom] = [Math.abs(numerator / divisor), Math.abs(denominator / divisor)];
  const negative = numerator * denominator < 0;
  if (bottom === 1) return [mathNumber(negative ? -top : top)];
  return [...(negative ? [{ op: "−" }] : []), { frac: [[mathNumber(top)], [mathNumber(bottom)]] }];
}

/** "3 across", "15 up", "6 down". */
function across(run: number): string {
  return `${formatNumber(run)} across`;
}

/** The student's fraction, across over up, and its value when that is simpler: 3/15 = 1/5. */
function studentWorking(p: Params): MathNode[] {
  const upsideDown: MathNode[] = [{ frac: [[mathNumber(p.run)], [mathNumber(p.rise)]] }];
  return gcd(p.run, p.rise) === 1 && p.rise > 0
    ? upsideDown
    : [...upsideDown, { op: "=" }, ...fraction(p.run, p.rise)];
}

/** The text around the grid, and the region the grid gets, in one format. */
interface Frame {
  before: SceneElement[];
  after: SceneElement[];
  grid: Rect;
}

/**
 * A little more height for a fraction line. KaTeX sets a minus in a denominator, and words such
 * as "up" over "across", a touch lower than the measured box allows; the box grows by a quarter
 * of the size so the glyphs stay inside it. `fromBottom` keeps the bottom edge where it was.
 */
function roomy(line: TextElement, fromBottom = false): TextElement {
  const extra = line.size * 0.25;
  return { ...line, y: fromBottom ? line.y - extra : line.y, h: line.h + extra };
}

function frame(p: Params, format: SceneFormat): Frame {
  const regions = REGIONS[format];
  const size = WORKING;
  const textRegion = regionRect(format, regions.text);
  const [question] = stack(
    [
      {
        id: "question",
        role: "given",
        content: `Work out the gradient of the straight line through ${coordinates(p.x1, p.y1, true)} and ${coordinates(p.x2, p.y2, true)}.`,
      },
    ],
    textRegion,
    { size },
  ) as [TextElement];
  const gradient: MathNode[] = [{ text: "gradient" }, { op: "=" }];
  const rule: MathNode[] = [{ frac: [[{ text: "up" }], [{ text: "across" }]] }];
  const correct: MathNode[] = [
    { op: "=" },
    { frac: [[mathNumber(p.rise)], [mathNumber(p.run)]] },
    { op: "=" },
    mathNumber(p.m),
  ];
  const style = { size, align: "start", valign: "top" } as const;

  if (format === "desktop") {
    // A column of working beside the grid: question, the student's line, the slip, the rule,
    // then the rule worked out.
    const student = roomy(
      text(
        "student.working",
        "student",
        [...gradient, ...studentWorking(p)],
        textRegion.x,
        question.y + question.h + size * 0.5,
        style,
      ),
    );
    const slip = slipRow(textRegion.x, student.y + student.h + size, textRegion.width);
    const words = roomy(
      text(
        "rule.words",
        "correct",
        [...gradient, ...rule],
        textRegion.x,
        slip.bottom + size * 0.4,
        style,
      ),
    );
    const beside = text(
      "answer.working",
      "correct",
      correct,
      words.x + words.w + size * 0.1,
      words.y,
      style,
    );
    const answer =
      beside.x + beside.w <= textRegion.x + textRegion.width
        ? beside
        : text(
            "answer.working",
            "correct",
            correct,
            textRegion.x,
            words.y + words.h + size * 0.2,
            style,
          );
    return {
      before: [question, student, ...slip.elements, words, answer],
      after: [],
      grid: regionRect(format, regions.grid),
    };
  }

  // On a phone the grid gets the middle. The student's fraction and the rule share the bottom
  // row when they fit, so the upside-down fraction sits beside the right one; otherwise the
  // student's line comes first and the rule goes underneath it.
  const bottom = textRegion.y + textRegion.height;
  const bottomStyle = { size, align: "start", valign: "bottom" } as const;
  const studentAt = (lineBottom: number) =>
    roomy(
      text("student.working", "student", studentWorking(p), textRegion.x, lineBottom, bottomStyle),
      true,
    );
  const ruleW = text("probe", "correct", rule, 0, 0, style).w;
  const answerW = text("probe", "correct", correct, 0, 0, style).w;
  const lowStudent = studentAt(bottom);
  const start = Math.max(
    lowStudent.x + lowStudent.w + size * 1.5,
    textRegion.x + textRegion.width / 2,
  );
  const sameRow = start + ruleW + size * 0.1 + answerW <= textRegion.x + textRegion.width;
  const words = roomy(
    text("rule.words", "correct", rule, sameRow ? start : textRegion.x, bottom, bottomStyle),
    true,
  );
  const student = sameRow ? lowStudent : studentAt(words.y - size * 0.2);
  const answer = text(
    "answer.working",
    "correct",
    correct,
    words.x + words.w + size * 0.1,
    bottom,
    bottomStyle,
  );
  const slipTop = Math.min(student.y, words.y, answer.y) - size * 0.3;
  const slip = slipRow(textRegion.x, 0, textRegion.width);
  const placedSlip = slipRow(textRegion.x, slipTop - slip.bottom, textRegion.width);
  const gridTop = question.y + question.h + size * 0.4;
  return {
    before: [question],
    after: [...placedSlip.elements, student, words, answer],
    grid: {
      x: textRegion.x,
      y: gridTop,
      width: textRegion.width,
      height: slipTop - slip.bottom - size * 0.8 - gridTop,
    },
  };
}

/** Results of the work below, kept: `draw` runs once a beat, in each format. */
const remembered = new Map<string, unknown>();

function remember<T>(key: string, work: () => T): T {
  if (!remembered.has(key)) {
    if (remembered.size > 200) remembered.clear();
    remembered.set(key, work());
  }
  return remembered.get(key) as T;
}

function keyOf(p: Params): string {
  return `${p.x1},${p.y1},${p.x2},${p.y2}`;
}

/**
 * The corner for the triangle, the same in both formats so the narration can name the legs in
 * the order they are drawn: whichever corner leaves every label room in both, then the one whose
 * labels sit nearest their objects.
 */
function cornerFor(p: Params): Corner {
  return remember(`corner:${keyOf(p)}`, () => {
    let best: { corner: Corner; score: number } | undefined;
    for (const corner of ["afterRun", "afterRise"] as const) {
      const score = (["desktop", "mobile"] as const)
        .map((format) => {
          const attempt = graph(p, frame(p, format).grid, corner);
          return attempt.misses * 1e6 + attempt.far;
        })
        .reduce((sum, value) => sum + value, 0);
      if (!best || score < best.score - 1) best = { corner, score };
    }
    return (best as { corner: Corner }).corner;
  });
}

/** Every element of the scene, in one format; `draw` shows those whose focus id is revealed. */
function layout(p: Params, format: SceneFormat): SceneElement[] {
  return remember(`layout:${keyOf(p)}:${format}`, () => {
    const parts = frame(p, format);
    return [...parts.before, ...graph(p, parts.grid, cornerFor(p)).elements, ...parts.after];
  });
}

/** "A common slip: across ÷ up", with a cross, from (left, top) in a column `width` wide. */
function slipRow(
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
  const slipText = "across ÷ up";
  const beside = text(
    "slip.reasoning",
    "misconception",
    slipText,
    title.x + title.w + size * 0.3,
    title.y + title.h / 2,
    { size, align: "start" },
  );
  const reasoning =
    beside.x + beside.w + size * 1.3 <= left + width
      ? beside
      : text("slip.reasoning", "misconception", slipText, left, title.y + title.h + size * 0.2, {
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
  return {
    elements: [title, reasoning, mark],
    bottom: Math.max(title.y + title.h, reasoning.y + reasoning.h),
  };
}

/**
 * Where the right angle goes: after the run (across from the first point, then up or down), or
 * after the rise (up or down from the first point, then across). Both give the same legs; the
 * scene uses whichever leaves every label room to sit beside its object.
 */
type Corner = "afterRun" | "afterRise";

/** The grid, the line through the two points, and the triangle with its legs labelled. */
function graph(
  p: Params,
  region: Rect,
  corner: Corner,
): { elements: SceneElement[]; misses: number; far: number } {
  // Every label in place first; then the labels nearest their objects. When labels still
  // clash, a wider range gives them more room.
  let best: { elements: SceneElement[]; misses: number; far: number } | undefined;
  for (let extra = 0; extra < 3 && (best?.misses ?? 1) > 0; extra += 1) {
    for (const pointsFirst of [false, true]) {
      const attempt = graphWith(p, region, corner, pointsFirst, extra);
      const score = attempt.misses * 1e6 + attempt.far;
      if (!best || score < best.misses * 1e6 + best.far - 1) best = attempt;
    }
  }
  return best as { elements: SceneElement[]; misses: number; far: number };
}

function graphWith(
  p: Params,
  region: Rect,
  cornerAt: Corner,
  pointsFirst: boolean,
  extra = 0,
): { elements: SceneElement[]; misses: number; far: number } {
  const gap = LABEL * 0.3;
  const afterRun = cornerAt === "afterRun";
  const room = (content: string) => measureText(content, LABEL).w + gap * 2;
  const riseRoom = room(upOrDown(p.rise));
  const needLeft = Math.max(room(coordinates(p.x1, p.y1)), afterRun ? 0 : riseRoom);
  const needRight = Math.max(room(coordinates(p.x2, p.y2)), afterRun ? riseRoom : 0);
  // The label for the run goes outside the triangle, above or below the level of the run.
  const runLevel = afterRun ? p.y1 : p.y2;
  const runBelow = afterRun === p.rise > 0;
  // Beyond the second point there is room for its label, and for the run label too when the
  // run is level with that point and its label hangs on the same side.
  const shared = !afterRun && runBelow === p.rise < 0;
  const needVertical = (LINE_HEIGHT * LABEL + gap * 2) * (shared ? 2 : 1);
  // Widen the range until each side has room for the labels beside it.
  const pads = { padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
  const build = () =>
    coordinateGrid({
      id: "grid",
      region,
      xs: [p.x1, p.x2],
      ys: [p.y1, p.y2],
      size: LABEL,
      pad: 1 + extra,
      ...pads,
    });
  let grid = build();
  for (let tries = 0; tries < 4; tries += 1) {
    const short = {
      padLeft: grid.px(p.x1) - region.x < needLeft,
      padRight: region.x + region.width - grid.px(p.x2) < needRight,
      // Room for the run's label, and for the second point's label beyond the end of the line.
      padBottom:
        (runBelow && region.y + region.height - grid.py(runLevel) < needVertical) ||
        (p.rise < 0 && region.y + region.height - grid.py(p.y2) < needVertical),
      padTop:
        (!runBelow && grid.py(runLevel) - region.y < needVertical) ||
        (p.rise > 0 && grid.py(p.y2) - region.y < needVertical),
    };
    if (!Object.values(short).some(Boolean)) break;
    for (const side of Object.keys(short) as (keyof typeof pads)[])
      pads[side] += short[side] ? 1 : 0;
    grid = build();
  }

  const a: [number, number] = [grid.px(p.x1), grid.py(p.y1)];
  const b: [number, number] = [grid.px(p.x2), grid.py(p.y2)];
  const c: [number, number] = afterRun ? [b[0], a[1]] : [a[0], b[1]];
  // The line stops short of the edge of the plot, clear of the axis arrowheads and names.
  const inner = {
    x: grid.plot.x + 8,
    y: grid.plot.y + 8,
    width: grid.plot.width - 16,
    height: grid.plot.height - 16,
  };
  const [from, to] = lineThrough(a, b, LABEL * 1.5, inner);
  const path = segmentedLine("line.path", "given", from, to);
  const dots = [
    dot("line.a", "given", a[0], a[1], LABEL),
    dot("line.b", "given", b[0], b[1], LABEL),
  ];

  // The right-angled triangle, its two legs meeting at c.
  const [runEnd, riseEnd] = afterRun ? [a, b] : [b, a];
  const run: SceneElement = {
    id: "triangle.run",
    role: "correct",
    type: "line",
    x1: runEnd[0],
    y1: c[1],
    x2: c[0],
    y2: c[1],
    width: 5,
  };
  const rise: SceneElement = {
    id: "triangle.rise",
    role: "correct",
    type: "line",
    x1: c[0],
    y1: c[1],
    x2: c[0],
    y2: riseEnd[1],
    width: 5,
  };
  const side = Math.min(
    LABEL * 0.45,
    Math.abs(runEnd[0] - c[0]) * 0.3,
    Math.abs(riseEnd[1] - c[1]) * 0.3,
  );
  const [hx, vy] = [Math.sign(runEnd[0] - c[0]) * side, Math.sign(riseEnd[1] - c[1]) * side];
  const square: SceneElement = {
    id: "triangle.corner",
    role: "correct",
    type: "polygon",
    open: true,
    points: [c[0] + hx, c[1], c[0] + hx, c[1] + vy, c[0], c[1] + vy],
  };

  const occupied = [...path, ...dots, run, rise, square].map(bounds).concat(grid.obstacles);
  // What the scale labels give way to: the lines, points and labels of the scene (not the axes).
  const content = occupied.slice(0, occupied.length - grid.obstacles.length);
  // Scale numbers keep further from the labels, so "1" never reads as part of "(1, −5)".
  const labelBoxes: Rect[] = [];
  let misses = 0;
  let far = 0;
  /** The first tier of spots with room wins; a stacked tier sets the words one to a line. */
  const place = (
    id: string,
    role: "given" | "correct",
    words: string,
    target: Rect,
    tiers: { spots: Spot[]; stacked?: boolean }[],
  ): TextElement => {
    const options = { size: LABEL, within: region, avoid: occupied };
    let label: TextElement | undefined;
    for (const tier of tiers) {
      const tried = placeLabel(id, role, words, tier.spots, { ...options, stacked: tier.stacked });
      label ??= tried;
      if (labelFits(tried, options)) {
        label = tried;
        break;
      }
    }
    const placed = label as TextElement;
    misses += labelFits(placed, options) ? 0 : 1;
    far += distance(bounds(placed), target);
    occupied.push(bounds(placed));
    content.push(bounds(placed));
    labelBoxes.push(bounds(placed));
    return placed;
  };
  // The leg labels sit outside the triangle where they can.
  const [outside, inside] = runBelow
    ? (["below", "above"] as const)
    : (["above", "below"] as const);
  const [riseOut, riseIn] = afterRun ? (["right", "left"] as const) : (["left", "right"] as const);
  // Last resorts when a leg runs right up to the y-axis: level with the leg, just past the axis.
  const x0 = grid.px(0);
  const runRow = (offset: number): Spot[] => {
    const y = outside === "below" ? c[1] + offset : c[1] - offset;
    const valign = outside === "below" ? "top" : "bottom";
    return [
      { x: x0 + gap, y, align: "start", valign },
      { x: x0 - gap, y, align: "end", valign },
    ];
  };
  const pastAxis: Spot[] = [0.5, 0.65, 0.35, 0.8, 0.2].flatMap((f): Spot[] => {
    const y = c[1] + (riseEnd[1] - c[1]) * f;
    return [
      { x: x0 + gap, y, align: "start", valign: "middle" },
      { x: x0 - gap, y, align: "end", valign: "middle" },
    ];
  });
  const y0 = grid.py(0);
  const runMiddle = (runEnd[0] + c[0]) / 2;
  // Above or below the x-axis level with the run, and to either side of the y-axis when the run
  // crosses it.
  const pastXAxis: Spot[] = [
    { x: runMiddle, y: y0 - gap, align: "middle", valign: "bottom" },
    { x: runMiddle, y: y0 + gap, align: "middle", valign: "top" },
    { x: x0 + gap, y: y0 - gap, align: "start", valign: "bottom" },
    { x: x0 - gap, y: y0 - gap, align: "end", valign: "bottom" },
    { x: x0 + gap, y: y0 + gap, align: "start", valign: "top" },
    { x: x0 - gap, y: y0 + gap, align: "end", valign: "top" },
  ];
  const besideRise = [
    ...spotsBeside(bounds(rise), riseOut, [gap]),
    ...spotsBeside(bounds(rise), riseIn, [gap]),
    ...spotsBeside(bounds(rise), riseOut, [gap * 3, gap * 5]),
  ];
  const legLabels = (): TextElement[] => [
    place("triangle.runLabel", "correct", across(p.run), bounds(run), [
      {
        spots: [
          ...spotsBeside(bounds(run), outside, [gap]),
          ...spotsBeside(bounds(run), inside, [gap]),
          ...spotsBeside(bounds(run), outside, [gap * 3, gap * 5, gap * 8]),
          ...runRow(gap),
          ...runRow(gap * 3),
        ],
      },
      { spots: pastXAxis },
    ]),
    // Too wide for the room beside the leg: one word to a line is narrower.
    place("triangle.riseLabel", "correct", upOrDown(p.rise), bounds(rise), [
      { spots: besideRise },
      { spots: besideRise, stacked: true },
      { spots: pastAxis },
      { spots: pastAxis, stacked: true },
    ]),
  ];
  // Each point gets its label on a side that the line leaves free.
  const around = (point: [number, number]) => ({
    x: point[0] - LABEL * 0.3,
    y: point[1] - LABEL * 0.3,
    width: LABEL * 0.6,
    height: LABEL * 0.6,
  });
  const gaps = [gap, gap * 3, gap * 6, gap * 9];
  const [aOrder, bOrder]: Direction[][] =
    p.rise > 0
      ? [
          ["aboveLeft", "belowRight", "below", "left", "above", "right", "belowLeft", "aboveRight"],
          ["aboveLeft", "belowRight", "left", "right", "above", "below", "belowLeft", "aboveRight"],
        ]
      : [
          ["belowLeft", "aboveRight", "left", "below", "above", "right", "aboveLeft", "belowRight"],
          ["belowLeft", "aboveRight", "below", "right", "left", "above", "aboveLeft", "belowRight"],
        ];
  const pointLabels = (): TextElement[] => [
    place("line.aLabel", "given", coordinates(p.x1, p.y1), around(a), [
      { spots: spotsAround(around(a), gaps, aOrder as Direction[]) },
    ]),
    place("line.bLabel", "given", coordinates(p.x2, p.y2), around(b), [
      { spots: spotsAround(around(b), gaps, bOrder as Direction[]) },
    ]),
  ];
  const labels = pointsFirst
    ? [...pointLabels(), ...legLabels()]
    : [...legLabels(), ...pointLabels()];
  const byId = (id: string) => labels.find((label) => label.id === id) as TextElement;

  return {
    elements: [
      ...grid.elements,
      ...clearOf(clearOf(grid.labels, content, LABEL * 0.2), labelBoxes, LABEL * 0.5),
      ...path,
      ...dots,
      byId("line.aLabel"),
      byId("line.bLabel"),
      run,
      rise,
      square,
      byId("triangle.runLabel"),
      byId("triangle.riseLabel"),
    ],
    misses,
    far,
  };
}

export const gradientTriangle: SceneTemplate<Params> = {
  key: "coordinate_grid.gradient_triangle",
  version: 1,
  primitive: "coordinate_grid",
  node: "A10",
  misconception: "GRADIENT_RUN_OVER_RISE",
  itemTemplate: "a10-gradient-two-points",
  title: "Gradient is up over across",
  focusIds: ["question", "grid", "line", "student", "triangle", "slip", "rule", "answer"],

  params(item) {
    const x1 = integer(item, "x1", -5, 3);
    const y1 = integer(item, "y1", -6, 6);
    const x2 = integer(item, "x2", x1 + 1, x1 + 4);
    const m = integer(item, "m", -5, 5);
    const y2 = integer(item, "y2", -26, 26);
    if (Math.abs(m) < 2)
      throw new Error("The gradient must be a whole number other than −1, 0 or 1");
    if (y2 !== y1 + m * (x2 - x1))
      throw new Error("The two points must lie on a line with gradient m");
    return { x1, y1, x2, y2, m, run: x2 - x1, rise: y2 - y1 };
  },

  spec(p, item, studentAnswer) {
    const [run, rise, m] = [formatNumber(p.run), formatNumber(p.rise), formatNumber(p.m)];
    const divisor = gcd(p.run, p.rise);
    const wrong = `${formatNumber((p.run / divisor) * Math.sign(p.rise))}/${formatNumber(Math.abs(p.rise / divisor))}`;
    return {
      schema: "scene-spec/1",
      template: "coordinate_grid.gradient_triangle@1",
      misconception: "GRADIENT_RUN_OVER_RISE",
      params: item,
      studentAnswer,
      correctAnswer: p.m,
      beats: [
        {
          kind: "show_given",
          focus: ["question", "grid", "line"],
          narration: `Work out the gradient of the straight line through ${coordinates(p.x1, p.y1)} and ${coordinates(p.x2, p.y2)}.`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You divided ${run} by ${rise} and got ${wrong}.`,
        },
        {
          kind: "build",
          focus: ["triangle"],
          narration: `Draw a right-angled triangle on the line. From the first point to the second, you go ${
            cornerFor(p) === "afterRun"
              ? `${across(p.run)} and ${upOrDown(p.rise)}`
              : `${upOrDown(p.rise)} and ${across(p.run)}`
          }.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration:
            "A common slip is to divide across by up. That turns the gradient upside down.",
        },
        {
          kind: "transform",
          focus: ["rule"],
          narration:
            "Gradient is up divided by across, so the up number goes on top of the fraction.",
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration:
            p.rise > 0
              ? `Up is ${rise} and across is ${run}, so the gradient is ${rise} divided by ${run}, which is ${m}.`
              : `Going down counts as negative, so up is ${rise}. Then ${rise} divided by ${run} is ${m}, so the gradient is ${m}.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    return layout(p, format).filter((element) => revealed.has(focusOf(element.id)));
  },

  predicted(p) {
    // Across over up.
    const divisor = gcd(p.run, p.rise);
    return ["Rational", (p.run / divisor) * Math.sign(p.rise), Math.abs(p.rise / divisor)];
  },

  claims(p): JsonValue[] {
    const divisor = gcd(p.run, p.rise);
    const upsideDown: JsonValue = [
      "Rational",
      (p.run / divisor) * Math.sign(p.rise),
      Math.abs(p.rise / divisor),
    ];
    return [
      ["Equal", ["Subtract", p.x2, p.x1], p.run],
      ["Equal", ["Subtract", p.y2, p.y1], p.rise],
      ["Equal", ["Divide", p.rise, p.run], p.m],
      ["Equal", ["Divide", p.run, p.rise], upsideDown],
    ];
  },

  sample: {
    item: { x1: -2, y1: 1, x2: 1, y2: -5, m: -2 },
    studentAnswer: ["Negate", ["Rational", 1, 2]],
  },
};
