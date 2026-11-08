import type { JsonValue } from "@eddy/schemas";
import { regionRect, type Rect, type SceneFormat } from "../canvas";
import { formatNumber } from "../layout/format";
import { bounds, paragraph, text } from "../layout/geometry";
import { LINE_HEIGHT, measureText } from "../layout/measure";
import type { SceneElement, TextElement } from "../layout/types";
import {
  clearOf,
  coordinates,
  distance,
  dot,
  labelFits,
  placeLabel,
  spotsAround,
  spotsBeside,
  type CoordinateGrid,
  type Direction,
  type Spot,
} from "../primitives/coordinate-grid";
import {
  columnVector,
  moveArrow,
  textLines,
  transformationGrid,
  wash,
} from "../primitives/transformation-grid";
import { integer, LABEL, layoutFor, upOrDown, withRefocusKinds, WORKING } from "./shared";
import type { SceneTemplate } from "./template";
import { focusOf } from "./template";

/** TRANSLATE_COMPONENTS_SWAPPED: (2, 3) translated by (5 over 1) taken to (3, 8), not (7, 4). */

interface Params {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

const REGIONS = layoutFor({
  desktop: { text: { x: 0, y: 0, w: 0.45, h: 1 }, grid: { x: 0.48, y: 0, w: 0.52, h: 1 } },
  // On a phone the grid takes the height the question and the notes leave between them.
  mobile: { text: { x: 0, y: 0, w: 1, h: 1 }, grid: { x: 0, y: 0, w: 1, h: 1 } },
});

/** "4 right", "1 left". */
function across(dx: number): string {
  return dx > 0 ? `${formatNumber(dx)} right` : `${formatNumber(-dx)} left`;
}

/** "4 up", "6 down". */
/** "−3 − 1", "−5 + 4": a coordinate and a move, as a sum. */
function sum(start: number, move: number): string {
  return `${formatNumber(start)} ${move < 0 ? "−" : "+"} ${formatNumber(Math.abs(move))}`;
}

/** Elements shown only until a later beat replaces them: the highlight moves to the next number. */
const UNTIL: Record<string, string> = {
  "across.wash": "up",
  "up.wash": "answer",
  // The student's own moves give way to the right ones.
  "student.acrossArrow": "across",
  "student.upArrow": "across",
  "student.acrossLabel": "across",
  "student.upLabel": "across",
};

/** Every element of the scene, in one format; `draw` shows those whose focus id is revealed. */
function layout(p: Params, format: SceneFormat): SceneElement[] {
  const regions = REGIONS[format];
  const size = WORKING;
  const textRegion = regionRect(format, regions.text);

  // The question, with the column vector beside it.
  const probe = columnVector("question.vector", "given", p.dx, p.dy, 0, 0, size);
  const words = paragraph(
    "question.text",
    "given",
    `The point ${coordinates(p.x, p.y, true)} is translated by this vector. Where is its image?`,
    textRegion.x,
    textRegion.y,
    textRegion.width - probe.box.width - size,
    { size },
  );
  const vector = columnVector(
    "question.vector",
    "given",
    p.dx,
    p.dy,
    words.x + words.w + size * 0.6,
    words.y + Math.max(0, (words.h - probe.box.height) / 2),
    size,
  );
  const questionBottom = Math.max(words.y + words.h, vector.box.y + vector.box.height);
  // Highlighter washes behind the number each move uses.
  const washes = [
    wash("across.wash", vector.top, size * 0.15),
    wash("up.wash", vector.bottom, size * 0.15),
  ];
  const question = [words, ...vector.elements, ...washes];

  if (format === "desktop") {
    const lines = notes(p, textRegion.x, questionBottom + size, textRegion.width);
    return [...question, ...lines.elements, ...grid(p, regionRect(format, regions.grid)).elements];
  }

  // On a phone the notes go under the grid or in a column beside it. The grid has square units,
  // so a tall range leaves width spare and a wide range leaves height spare. The scene uses the
  // arrangement where every label fits, and then the one with the bigger squares.
  const top = questionBottom + size * 0.5;
  const bottom = textRegion.y + textRegion.height;
  const column = textRegion.width * 0.42;
  const trial = notes(p, textRegion.x, 0, textRegion.width);
  const belowNotes = notes(p, textRegion.x, bottom - trial.bottom, textRegion.width);
  const below = {
    notes: belowNotes.elements,
    grid: grid(p, {
      x: textRegion.x,
      y: top,
      width: textRegion.width,
      height: bottom - trial.bottom - size * 0.5 - top,
    }),
  };
  const besideNotes = notes(p, textRegion.x + textRegion.width - column, top, column);
  const fitsColumn = besideNotes.elements.every(
    (element) => bounds(element).x + bounds(element).width <= textRegion.x + textRegion.width,
  );
  if (!fitsColumn) return [...question, ...below.notes, ...below.grid.elements];
  const beside = {
    notes: besideNotes.elements,
    grid: grid(p, {
      x: textRegion.x,
      y: top,
      width: textRegion.width - column - size * 0.5,
      height: bottom - top,
    }),
  };
  const roomier =
    beside.grid.unit > below.grid.unit * 1.3 && beside.grid.far <= below.grid.far + LABEL;
  const chosen =
    beside.grid.misses !== below.grid.misses
      ? beside.grid.misses < below.grid.misses
        ? beside
        : below
      : roomier
        ? beside
        : below;
  return [...question, ...chosen.notes, ...chosen.grid.elements];
}

function xsOf(p: Params): number[] {
  return [p.x, p.x + p.dx, p.x + p.dy];
}

function ysOf(p: Params): number[] {
  return [p.y, p.y + p.dy, p.y + p.dx];
}

/**
 * The student's answer, the slip and the working for the image, stacked from (left, top) in a
 * column `width` wide. `bottom` is where they end.
 */
function notes(
  p: Params,
  left: number,
  top: number,
  width: number,
): { elements: SceneElement[]; bottom: number } {
  const size = WORKING;
  const image = { x: p.x + p.dx, y: p.y + p.dy };
  const swapped = { x: p.x + p.dy, y: p.y + p.dx };
  const wrote = `You wrote ${coordinates(swapped.x, swapped.y, true)}.`;
  const student =
    measureText(wrote, size).w <= width
      ? textLines("student.text", "student", [wrote], left, top, size)
      : textLines(
          "student.text",
          "student",
          ["You wrote", `${coordinates(swapped.x, swapped.y, true)}.`],
          left,
          top,
          size,
        );
  const title = text(
    "slip.title",
    "misconception",
    "A common slip:",
    left,
    student.y + student.h + size * 0.4,
    {
      size,
      font: "pen",
      align: "start",
      valign: "top",
    },
  );
  // The reason sits after the title when the row has room, with the cross after it.
  const reason = "moves swapped";
  const markW = size * 1.2;
  const beside = text(
    "slip.reasoning",
    "misconception",
    reason,
    title.x + title.w + size * 0.3,
    title.y + title.h / 2,
    { size, align: "start" },
  );
  const reasoning =
    beside.x + beside.w + markW <= left + width
      ? beside
      : paragraph(
          "slip.reasoning",
          "misconception",
          reason,
          left,
          title.y + title.h + size * 0.1,
          width - markW,
          { size },
        );
  const lastLine = reasoning.text?.split("\n").at(-1) ?? reason;
  const lastWidth = text("probe", "misconception", lastLine, 0, 0, { size }).w;
  const mark: SceneElement = {
    id: "slip.mark",
    role: "misconception",
    type: "mark",
    kind: "cross",
    x: reasoning.x + lastWidth + size * 0.3,
    y: reasoning.y + reasoning.h - LINE_HEIGHT * size * 0.85,
    w: size * 0.7,
    h: LINE_HEIGHT * size * 0.7,
  };
  // The image as a sum of moves, then its coordinates: on one row when there is room.
  const slipBottom = Math.max(title.y + title.h, reasoning.y + reasoning.h);
  const working = text(
    "answer.working",
    "correct",
    `(${sum(p.x, p.dx)}, ${sum(p.y, p.dy)})`,
    left,
    slipBottom + size * 0.4,
    {
      size,
      align: "start",
      valign: "top",
    },
  );
  const result = `= ${coordinates(image.x, image.y)}`;
  const sameRow = text(
    "answer.text",
    "correct",
    result,
    working.x + working.w + size * 0.2,
    working.y,
    { size, align: "start", valign: "top" },
  );
  const answer =
    sameRow.x + sameRow.w <= left + width
      ? sameRow
      : text("answer.text", "correct", result, left, working.y + working.h, {
          size,
          align: "start",
          valign: "top",
        });
  return {
    elements: [student, title, reasoning, mark, working, answer],
    bottom: answer.y + answer.h,
  };
}

/** The grid with the point, the student's image, the two moves and the true image. */
function grid(
  p: Params,
  region: Rect,
): { elements: SceneElement[]; misses: number; far: number; unit: number } {
  // Every label in place first; then the labels nearest their objects. When labels still
  // clash, a wider range gives them more room.
  let best:
    | { elements: SceneElement[]; misses: number; far: number; score: number; unit: number }
    | undefined;
  for (let extra = 0; extra < 3 && (best?.misses ?? 1) > 0; extra += 1) {
    const plane = roomyGrid(p, region, extra);
    for (const order of [0, 1, 2, 3, 4]) {
      const attempt = gridWith(p, region, plane, order);
      const score = attempt.misses * 1e6 + attempt.far;
      if (!best || score < best.score - 1)
        best = { ...attempt, score, unit: plane.px(1) - plane.px(0) };
    }
  }
  const chosen = best as { elements: SceneElement[]; misses: number; far: number; unit: number };
  return { elements: chosen.elements, misses: chosen.misses, far: chosen.far, unit: chosen.unit };
}

/** The grid, its range widened until the outermost points have room for a label beyond them. */
function roomyGrid(p: Params, region: Rect, extra = 0): CoordinateGrid {
  const gap = LABEL * 0.3;
  const points = [
    { x: p.x, y: p.y },
    { x: p.x + p.dx, y: p.y + p.dy },
    { x: p.x + p.dy, y: p.y + p.dx },
  ];
  const width = (point: { x: number; y: number }) =>
    measureText(coordinates(point.x, point.y), LABEL).w;
  const pads = { padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
  const build = () =>
    transformationGrid({
      id: "grid",
      region,
      xs: xsOf(p),
      ys: ysOf(p),
      size: LABEL,
      pad: 1 + extra,
      ...pads,
    });
  let plane = build();
  for (let tries = 0; tries < 3; tries += 1) {
    const vertical = LINE_HEIGHT * LABEL + gap * 2;
    const short = {
      padTop: points.some((q) => plane.py(q.y) - region.y < vertical),
      padBottom: points.some((q) => region.y + region.height - plane.py(q.y) < vertical),
      padLeft: points.some((q) => plane.px(q.x) - region.x < width(q) / 2 + gap),
      padRight: points.some((q) => region.x + region.width - plane.px(q.x) < width(q) / 2 + gap),
    };
    if (!Object.values(short).some(Boolean)) break;
    for (const side of Object.keys(short) as (keyof typeof pads)[])
      pads[side] += short[side] ? 1 : 0;
    plane = build();
  }
  // Square units leave spare width (or height) when the range is tall (or wide): show more of
  // the grid there, a unit at a time on alternate sides, as long as the squares stay the same size.
  const unit = plane.px(1) - plane.px(0);
  for (const [first, second] of [
    ["padLeft", "padRight"],
    ["padTop", "padBottom"],
  ] as const) {
    for (let step = 0; step < 8; step += 1) {
      const side = step % 2 === 0 ? first : second;
      pads[side] += 1;
      const wider = build();
      if (wider.px(1) - wider.px(0) < unit - 0.01) {
        pads[side] -= 1;
        break;
      }
      plane = wider;
    }
  }
  return plane;
}

function gridWith(
  p: Params,
  region: Rect,
  plane: CoordinateGrid,
  order: number,
): { elements: SceneElement[]; misses: number; far: number } {
  const gap = LABEL * 0.3;
  const image = { x: p.x + p.dx, y: p.y + p.dy };
  const swapped = { x: p.x + p.dy, y: p.y + p.dx };
  const at = (x: number, y: number): [number, number] => [plane.px(x), plane.py(y)];
  const start = at(p.x, p.y);
  const turn = at(image.x, p.y);
  const end = at(image.x, image.y);
  const wrong = at(swapped.x, swapped.y);
  const wrongTurn = at(swapped.x, p.y);
  const [x0, y0] = [plane.px(0), plane.py(0)];

  const point = dot("point.dot", "given", start[0], start[1], LABEL);
  const studentDot = dot("student.dot", "student", wrong[0], wrong[1], LABEL);
  const imageDot = dot("answer.dot", "correct", end[0], end[1], LABEL);
  const acrossArrow = moveArrow("across.arrow", "correct", start, turn);
  const upArrow = moveArrow("up.arrow", "correct", turn, end);
  // The student's moves, dashed in their colour: the bottom number across, the top one up.
  const studentAcross = {
    ...moveArrow("student.acrossArrow", "student", start, wrongTurn),
    dash: true,
  };
  const studentUp = { ...moveArrow("student.upArrow", "student", wrongTurn, wrong), dash: true };

  // The image gets a ring in the last beat; its label keeps clear of the ring.
  const ring = LABEL * 0.6;
  const ringBox = {
    x: end[0] - ring - 3,
    y: end[1] - ring - 3,
    width: 2 * ring + 6,
    height: 2 * ring + 6,
  };
  // What shares the canvas with what: the points and their labels are there throughout; the
  // student's moves leave before the right moves arrive, so each set only avoids its own.
  const shared: Rect[] = [point, studentDot].map(bounds).concat(plane.obstacles);
  const studentOnly: Rect[] = [studentAcross, studentUp].map(bounds);
  const correctOnly: Rect[] = [imageDot, acrossArrow, upArrow].map(bounds).concat([ringBox]);
  // Scale numbers keep further from the labels, so "1" never reads as part of "(1, −6)".
  const labelBoxes: Rect[] = [];
  const content: Rect[] = [
    point,
    studentDot,
    imageDot,
    acrossArrow,
    upArrow,
    studentAcross,
    studentUp,
  ].map(bounds);
  // Move labels keep a little further from the points than other labels do.
  const keepOut = (centre: [number, number]): Rect => ({
    x: centre[0] - LABEL * 0.6,
    y: centre[1] - LABEL * 0.6,
    width: LABEL * 1.2,
    height: LABEL * 1.2,
  });
  type Group = "shared" | "student" | "correct";
  let misses = 0;
  let far = 0;
  /** The first tier of spots with room wins; a stacked tier sets the words one to a line. */
  const place = (
    id: string,
    role: "given" | "student" | "correct",
    words: string,
    target: Rect,
    group: Group,
    tiers: { spots: Spot[]; stacked?: boolean }[],
    extra: Rect[] = [],
    weight = 1,
  ): TextElement => {
    const avoid =
      group === "shared"
        ? [...shared, ...studentOnly, ...correctOnly]
        : group === "student"
          ? [...shared, ...studentOnly]
          : [...shared, ...correctOnly];
    const options = { size: LABEL, within: region, avoid };
    // The extra clearance is a preference: every tier is tried with it before any without it.
    const passes = extra.length > 0 ? [[...avoid, ...extra], avoid] : [avoid];
    let label: TextElement | undefined;
    search: for (const pass of passes) {
      for (const tier of tiers) {
        const tried = placeLabel(id, role, words, tier.spots, {
          ...options,
          avoid: pass,
          stacked: tier.stacked,
        });
        label ??= tried;
        if (labelFits(tried, { ...options, avoid: pass })) {
          label = tried;
          break search;
        }
      }
    }
    const placed = label as TextElement;
    misses += labelFits(placed, options) ? 0 : 1;
    // A move label far from its arrow counts for more: it must read as that arrow's label.
    far += distance(bounds(placed), target) * weight;
    (group === "shared" ? shared : group === "student" ? studentOnly : correctOnly).push(
      bounds(placed),
    );
    content.push(bounds(placed));
    labelBoxes.push(bounds(placed));
    return placed;
  };
  const around = (point: [number, number]) => ({
    x: point[0] - LABEL * 0.3,
    y: point[1] - LABEL * 0.3,
    width: LABEL * 0.6,
    height: LABEL * 0.6,
  });
  const gaps = [gap, gap * 3, gap * 6, gap * 9];
  // The start point's label sits behind it, away from the first move; the image's label sits
  // beyond it, away from the second move. Any side will do when those are taken.
  const ALL: Direction[] = [
    "right",
    "left",
    "above",
    "below",
    "aboveRight",
    "aboveLeft",
    "belowRight",
    "belowLeft",
  ];
  const prefer = (first: Direction[]): Direction[] => [
    ...first,
    ...ALL.filter((d) => !first.includes(d)),
  ];
  // The side the first move heads comes last: there the label would sit by the arrow's tip.
  const ahead: Direction = p.dx > 0 ? "right" : "left";
  const startOrder = [
    ...prefer(
      p.dx > 0 ? ["left", "aboveLeft", "belowLeft"] : ["right", "aboveRight", "belowRight"],
    ).filter((direction) => direction !== ahead),
    ahead,
  ];
  const imageOrder = prefer(
    p.dy > 0 ? ["above", "aboveRight", "aboveLeft"] : ["below", "belowRight", "belowLeft"],
  );

  /** Labels for a pair of moves: across, then up or down. */
  const moveLabels = (
    ids: [string, string],
    role: "student" | "correct",
    group: Group,
    words: [string, string],
    arrows: [SceneElement, SceneElement],
    moves: [number, number],
    corners: [number, number][],
    upFirst: boolean,
  ): TextElement[] => {
    const [acrossBox, upBox] = arrows.map(bounds) as [Rect, Rect];
    const extra = corners.map(keepOut);
    // Last resorts beside a move that runs along or across an axis: just past the axis.
    const fractions = [0.5, 0.25, 0.75];
    const acrossPast: Spot[] = [
      ...fractions.flatMap((f): Spot[] => {
        const x = acrossBox.x + f * acrossBox.width;
        return [
          { x, y: y0 - gap, align: "middle", valign: "bottom" },
          { x, y: y0 + gap, align: "middle", valign: "top" },
        ];
      }),
      { x: x0 + gap, y: acrossBox.y - gap, align: "start", valign: "bottom" },
      { x: x0 - gap, y: acrossBox.y - gap, align: "end", valign: "bottom" },
      { x: x0 + gap, y: acrossBox.y + acrossBox.height + gap, align: "start", valign: "top" },
      { x: x0 - gap, y: acrossBox.y + acrossBox.height + gap, align: "end", valign: "top" },
    ];
    const upPast: Spot[] = fractions.flatMap((f): Spot[] => {
      const y = upBox.y + f * upBox.height;
      return [
        { x: x0 + gap, y, align: "start", valign: "middle" },
        { x: x0 - gap, y, align: "end", valign: "middle" },
      ];
    });
    for (const lift of [gap, gap * 3]) {
      upPast.push(
        { x: upBox.x + upBox.width + gap, y: y0 - lift, align: "start", valign: "bottom" },
        { x: upBox.x - gap, y: y0 - lift, align: "end", valign: "bottom" },
        { x: upBox.x + upBox.width + gap, y: y0 + lift, align: "start", valign: "top" },
        { x: upBox.x - gap, y: y0 + lift, align: "end", valign: "top" },
      );
    }
    // Across: above or below the arrow, on the side away from the second move.
    const [first, second] =
      moves[1] > 0 ? (["below", "above"] as const) : (["above", "below"] as const);
    // Up or down: beside the arrow, on the side away from the start point.
    const [side, other] =
      moves[0] > 0 ? (["right", "left"] as const) : (["left", "right"] as const);
    const besideAcross = [
      ...spotsBeside(acrossBox, first, [gap * 0.5, gap * 2]),
      ...spotsBeside(acrossBox, second, [gap * 0.5, gap * 2]),
    ];
    const besideUp = [
      ...spotsBeside(upBox, side, [gap * 0.5, gap * 2]),
      ...spotsBeside(upBox, other, [gap * 0.5, gap * 2]),
    ];
    // Just past the tip of the across arrow, on its line: still beside the arrow when a point's
    // label takes the space above or below it.
    const acrossLine = arrows[0] as { x2: number; y2: number };
    const tipGap = gap + LABEL * 0.4;
    const pastTip: Spot = {
      x: acrossLine.x2 + Math.sign(moves[0]) * tipGap,
      y: acrossLine.y2,
      align: moves[0] > 0 ? "start" : "end",
      valign: "middle",
    };
    const acrossLabel = () =>
      place(
        ids[0],
        role,
        words[0],
        acrossBox,
        group,
        [
          { spots: [...besideAcross, pastTip] },
          { spots: [...spotsBeside(acrossBox, first, [gap * 4, gap * 6]), ...acrossPast] },
          // One word to a line ("6" over "right") leaves room beside a crowded arrow.
          { spots: besideAcross, stacked: true },
        ],
        extra,
        3,
      );
    const upLabel = () =>
      place(
        ids[1],
        role,
        words[1],
        upBox,
        group,
        [
          { spots: besideUp },
          { spots: besideUp, stacked: true },
          { spots: [...spotsBeside(upBox, side, [gap * 4, gap * 6]), ...upPast] },
          { spots: upPast, stacked: true },
        ],
        extra,
        3,
      );
    if (upFirst) {
      const up = upLabel();
      return [acrossLabel(), up];
    }
    const acrossFirst = acrossLabel();
    return [acrossFirst, upLabel()];
  };
  const arrowLabels = (upFirst = false): TextElement[] => [
    ...moveLabels(
      ["across.label", "up.label"],
      "correct",
      "correct",
      [across(p.dx), upOrDown(p.dy)],
      [acrossArrow, upArrow],
      [p.dx, p.dy],
      [start, end],
      upFirst,
    ),
    ...moveLabels(
      ["student.acrossLabel", "student.upLabel"],
      "student",
      "student",
      [across(p.dy), upOrDown(p.dx)],
      [studentAcross, studentUp],
      [p.dy, p.dx],
      [start, wrong],
      upFirst,
    ),
  ];
  const pointLabels = (): TextElement[] => [
    place("point.label", "given", coordinates(p.x, p.y), around(start), "shared", [
      { spots: spotsAround(around(start), gaps, startOrder) },
    ]),
    place("student.label", "student", coordinates(swapped.x, swapped.y), around(wrong), "shared", [
      { spots: spotsAround(around(wrong), gaps, ALL) },
    ]),
  ];
  const imageLabel = (): TextElement =>
    place("answer.label", "correct", coordinates(image.x, image.y), ringBox, "correct", [
      { spots: spotsAround(ringBox, gaps, imageOrder) },
    ]);
  // Which labels choose their places first: the moves' or the points', and which move.
  const labels =
    order === 0
      ? [...arrowLabels(), ...pointLabels(), imageLabel()]
      : order === 1
        ? [...pointLabels(), imageLabel(), ...arrowLabels()]
        : order === 2
          ? [...pointLabels().reverse(), ...arrowLabels(), imageLabel()]
          : order === 3
            ? [...arrowLabels(true), ...pointLabels(), imageLabel()]
            : [...pointLabels(), ...arrowLabels(true), imageLabel()];
  const byId = (id: string) => labels.find((label) => label.id === id) as TextElement;
  return {
    elements: [
      ...plane.elements,
      ...clearOf(clearOf(plane.labels, content, LABEL * 0.2), labelBoxes, LABEL * 0.5),
      studentAcross,
      byId("student.acrossLabel"),
      studentUp,
      byId("student.upLabel"),
      point,
      byId("point.label"),
      studentDot,
      byId("student.label"),
      acrossArrow,
      byId("across.label"),
      upArrow,
      byId("up.label"),
      imageDot,
      byId("answer.label"),
      {
        id: "answer.ring",
        role: "correct",
        type: "mark",
        kind: "ring",
        x: end[0] - ring,
        y: end[1] - ring,
        w: 2 * ring,
        h: 2 * ring,
      },
    ],
    misses,
    far,
  };
}

export const translation: SceneTemplate<Params> = {
  key: "transformation_grid.translate",
  version: 1,
  primitive: "transformation_grid",
  node: "G7",
  misconception: "TRANSLATE_COMPONENTS_SWAPPED",
  itemTemplate: "g7-translation",
  title: "Translating by a column vector",
  focusIds: ["question", "grid", "point", "student", "slip", "across", "up", "answer"],
  beatKinds: withRefocusKinds(
    "show_given",
    "show_student_working",
    "highlight_slip",
    "build",
    "transform",
    "reveal_correct",
  ),

  params(item) {
    const x = integer(item, "x", -5, 5);
    const y = integer(item, "y", -5, 5);
    const dx = integer(item, "dx", -6, 6);
    const dy = integer(item, "dy", -6, 6);
    if (dx === 0 || dy === 0) throw new Error("Both moves must be non-zero");
    if (dx === dy) throw new Error("The two moves must differ, or swapping them changes nothing");
    return { x, y, dx, dy };
  },

  spec(p, item, studentAnswer) {
    const image = coordinates(p.x + p.dx, p.y + p.dy);
    return {
      schema: "scene-spec/1",
      template: "transformation_grid.translate@1",
      misconception: "TRANSLATE_COMPONENTS_SWAPPED",
      params: item,
      studentAnswer,
      correctAnswer: ["Tuple", p.x + p.dx, p.y + p.dy],
      beats: [
        {
          kind: "show_given",
          focus: ["question", "grid", "point"],
          narration: `The point ${coordinates(p.x, p.y)} is translated by the column vector with ${formatNumber(p.dx)} on top and ${formatNumber(p.dy)} underneath. Where is its image?`,
        },
        {
          kind: "show_student_working",
          focus: ["student"],
          narration: `You moved ${across(p.dy)} and ${upOrDown(p.dx)}, and got ${coordinates(p.x + p.dy, p.y + p.dx)}.`,
        },
        {
          kind: "highlight_slip",
          focus: ["slip"],
          narration:
            "A common slip is to swap the two numbers. You used the bottom number to move across.",
        },
        {
          kind: "build",
          focus: ["across"],
          narration: `The top number, ${formatNumber(p.dx)}, moves the point across: ${across(p.dx)}.`,
        },
        {
          kind: "transform",
          focus: ["up"],
          narration: `The bottom number, ${formatNumber(p.dy)}, moves it up or down: ${upOrDown(p.dy)}.`,
        },
        {
          kind: "reveal_correct",
          focus: ["answer"],
          narration: `So the image is ${image}. The top number moves across, and the bottom number moves up or down.`,
        },
      ],
    };
  },

  draw(p, format, revealed) {
    return layout(p, format).filter((element) => {
      const until = UNTIL[element.id];
      return revealed.has(focusOf(element.id)) && !(until && revealed.has(until));
    });
  },

  predicted(p) {
    // The bottom number moves it across and the top number moves it up or down.
    return ["Tuple", p.x + p.dy, p.y + p.dx];
  },

  claims(p): JsonValue[] {
    // Each coordinate of the image, one claim apiece (maths-core reads relations between numbers).
    return [
      ["Equal", ["Add", p.x, p.dx], p.x + p.dx],
      ["Equal", ["Add", p.y, p.dy], p.y + p.dy],
    ];
  },

  sample: { item: { x: -3, y: -5, dx: -1, dy: 4 }, studentAnswer: ["Tuple", 1, -6] },
};
