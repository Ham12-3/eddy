import type { Rect } from "../canvas";
import {
  bounds,
  contains,
  grow,
  overlaps,
  type Point,
  slantedLine,
  text,
} from "../layout/geometry";
import type { MathNode, SceneElement, TextElement } from "../layout/types";

/**
 * Probability tree: two stages of two outcomes each, with the probability on every branch as a
 * maths label and each outcome named at the end of its branch. It grows left to right ("across",
 * the usual way) or top to bottom ("down", for a narrow stage). The spread is the largest that
 * keeps every label clear of every branch and of every other label.
 */

export interface Outcome {
  name: string;
  probability: MathNode[];
}

export interface TreeOptions {
  id: string;
  region: Rect;
  orientation: "across" | "down";
  size: number;
  first: readonly [Outcome, Outcome];
  /** The second stage, the same after either first outcome (independent events). */
  second: readonly [Outcome, Outcome];
}

export interface TreeBranch {
  /** "first.0", "second.0.1": the stage, the first outcome and (for stage two) the second. */
  key: string;
  from: Point;
  to: Point;
  /** The outcome's name at the end of the branch, and the probability beside it. */
  name: TextElement;
  probability: TextElement;
  lines: SceneElement[];
}

export interface Tree {
  elements: SceneElement[];
  branches: TreeBranch[];
  /** A branch by key, for drawing over a path. */
  branch: (key: string) => TreeBranch;
}

interface Frame {
  /** From the tree's coordinates (depth from the root, spread from the middle) to the canvas. */
  at: (depth: number, spread: number) => Point;
  /** How deep and how wide a label reaches along each axis. */
  depthOf: (label: TextElement) => number;
  depthRoom: number;
  spreadRoom: number;
}

function frameFor(region: Rect, orientation: "across" | "down"): Frame {
  if (orientation === "across") {
    const middle = region.y + region.height / 2;
    return {
      at: (depth, spread) => ({ x: region.x + depth, y: middle + spread }),
      depthOf: (label) => label.w,
      depthRoom: region.width,
      spreadRoom: region.height,
    };
  }
  const middle = region.x + region.width / 2;
  return {
    at: (depth, spread) => ({ x: middle + spread, y: region.y + depth }),
    depthOf: (label) => label.h,
    depthRoom: region.height,
    spreadRoom: region.width,
  };
}

/** The outcome's name just past the end of its branch. */
function nameAt(
  id: string,
  name: string,
  end: Point,
  options: TreeOptions,
  gap: number,
): TextElement {
  return options.orientation === "across"
    ? text(id, "given", name, end.x + gap, end.y, { size: options.size, align: "start" })
    : text(id, "given", name, end.x, end.y + gap, { size: options.size, valign: "top" });
}

/**
 * The probability beside a branch, on its outer side: moved out from the branch's midpoint, across
 * the tree's spread, until it clears the branch.
 */
function probabilityAt(
  id: string,
  content: MathNode[],
  from: Point,
  to: Point,
  lines: readonly SceneElement[],
  options: TreeOptions,
  gap: number,
): TextElement {
  const outward =
    options.orientation === "across"
      ? { x: 0, y: Math.sign(to.y - from.y) }
      : { x: Math.sign(to.x - from.x), y: 0 };
  const base = text(id, "given", content, 0, 0, { size: options.size });
  const boxes = lines.map((line) => grow(bounds(line), gap));
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  for (let distance = 0; distance < 400; distance += 3) {
    const label = {
      ...base,
      x: base.x + middle.x + outward.x * distance,
      y: base.y + middle.y + outward.y * distance,
    };
    if (!boxes.some((box) => overlaps(bounds(label), box))) return label;
  }
  return { ...base, x: base.x + middle.x, y: base.y + middle.y };
}

function build(
  options: TreeOptions,
  frame: Frame,
  spreadFirst: number,
  spreadSecond: number,
  branchLength: number,
  gap: number,
): Tree {
  const { id } = options;
  const branches: TreeBranch[] = [];
  const firstNames = options.first.map((outcome, i) =>
    nameAt(`${id}.name.${i}`, outcome.name, { x: 0, y: 0 }, options, gap),
  );
  const nameDepth = Math.max(...firstNames.map(frame.depthOf));
  const secondStart = branchLength + gap + nameDepth + gap;
  const add = (key: string, from: Point, to: Point, outcome: Outcome) => {
    const lines = slantedLine(`${id}.branch.${key}`, "given", from, to);
    branches.push({
      key,
      from,
      to,
      name: nameAt(`${id}.name.${key}`, outcome.name, to, options, gap),
      probability: probabilityAt(
        `${id}.chance.${key}`,
        outcome.probability,
        from,
        to,
        lines,
        options,
        gap,
      ),
      lines,
    });
  };
  options.first.forEach((outcome, i) => {
    const side = i === 0 ? -1 : 1;
    const to = frame.at(branchLength, side * spreadFirst);
    add(`first.${i}`, frame.at(0, 0), to, outcome);
    options.second.forEach((next, j) => {
      const sideNext = j === 0 ? -1 : 1;
      add(
        `second.${i}.${j}`,
        frame.at(secondStart, side * spreadFirst),
        frame.at(secondStart + branchLength, side * spreadFirst + sideNext * spreadSecond),
        next,
      );
    });
  });
  const elements = branches.flatMap((branch) => [...branch.lines, branch.name, branch.probability]);
  return {
    elements,
    branches,
    branch: (key) => {
      const found = branches.find((branch) => branch.key === key);
      if (!found) throw new Error(`No branch ${key}`);
      return found;
    },
  };
}

/** Whether every element sits in the region and no label touches a branch or another label. */
/** How far a point is from the segment between two points. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const along = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy));
}

/** Whether each probability reads as its own branch's: clearly nearer it than any other branch. */
function unambiguous(tree: Tree): boolean {
  return tree.branches.every((branch) => {
    const label = branch.probability;
    const centre = { x: label.x + label.w / 2, y: label.y + label.h / 2 };
    const own = distanceToSegment(centre, branch.from, branch.to);
    return tree.branches.every(
      (other) => other === branch || own < 0.6 * distanceToSegment(centre, other.from, other.to),
    );
  });
}

/**
 * Whether every element sits in the region, no label touches a branch or another label, and each
 * probability is clearly beside its own branch.
 */
function fits(tree: Tree, region: Rect, gap: number): boolean {
  const labels = tree.elements.filter((element) => element.type === "text");
  const lines = tree.elements.filter((element) => element.type !== "text");
  if (!tree.elements.every((element) => contains(region, bounds(element)))) return false;
  if (!unambiguous(tree)) return false;
  return labels.every((label, i) => {
    const box = grow(bounds(label), gap / 2);
    return (
      !labels.slice(i + 1).some((other) => overlaps(box, grow(bounds(other), gap / 2))) &&
      !lines.some((line) => overlaps(box, bounds(line)))
    );
  });
}

export function probabilityTree(options: TreeOptions): Tree {
  const { size } = options;
  // Line ends reach a little past their points: keep them inside the region.
  const region = grow(options.region, -4);
  const gap = size * 0.3;
  const frame = frameFor(region, options.orientation);
  // Depth: two branches, the first outcomes' names and the second outcomes' names.
  const probe = build(options, frame, 1, 1, 1, gap);
  const nameDepth = (stage: string) =>
    Math.max(
      ...probe.branches
        .filter((branch) => branch.key.startsWith(stage))
        .map((branch) => frame.depthOf(branch.name)),
    );
  const branchLength = (frame.depthRoom - 4 * gap - nameDepth("first") - nameDepth("second")) / 2;
  // Spread: as wide as fits. The second stage spreads half as far as the first, so the four ends
  // sit evenly, or less when the labels between the two pairs need the room to stay clearly
  // beside their own branches.
  for (let spread = frame.spreadRoom / 3; spread > size; spread -= 4) {
    for (const share of [0.5, 0.45, 0.4, 0.35, 0.3]) {
      const tree = build(options, frame, spread, spread * share, branchLength, gap);
      if (fits(tree, options.region, gap)) return tree;
    }
  }
  // Nothing fitted: return the tightest, and let the static checks report it.
  return build(options, frame, size, size / 2, branchLength, gap);
}
