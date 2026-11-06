import {
  AA_BODY_TEXT,
  AA_LARGE_TEXT_AND_UI,
  colours,
  contrastRatio,
  type ColourToken,
  type Mode,
} from "@eddy/ui/colour";
import {
  FILL_TINT,
  HIGHLIGHT_WASH,
  minTextSize,
  safeArea,
  SCENE_FORMATS,
  type SceneFormat,
} from "../canvas";
import katex from "katex";
import { bounds, contains, overlaps } from "../layout/geometry";
import { KATEX_OPTIONS, mathsToTex, SCRIPT_SCALE } from "../layout/measure";
import type { MathNode, Role, SceneElement, SceneLayout, TextElement } from "../layout/types";
import { ROLES } from "../layout/types";
import { belongsTo, type BuiltScene } from "../templates/template";
import { beatTimings, moves, type BeatTiming } from "../timeline/timeline";

/**
 * Static checks on a computed layout, before anything renders (SPEC.md section 7.2, step 6):
 * overlap, off-canvas, 6% safe margins, text overflow, minimum font size, contrast of every colour
 * role on both themes, colour semantics, at most 3 moving elements per beat, and no flashing above
 * 3 a second. The keyframe checker then confirms the real DOM boxes in a browser.
 */

export const CHECKS = [
  "off_canvas",
  "margins",
  "overlap",
  "overflow",
  "font_size",
  "contrast",
  "colour_roles",
  "moving_elements",
  "flash_rate",
  "focus",
] as const;
export type CheckName = (typeof CHECKS)[number];

export interface CheckProblem {
  check: CheckName;
  format: SceneFormat;
  /** The beat whose end state (or transition into it) has the problem; -1 for the whole scene. */
  beat: number;
  ids: string[];
  message: string;
}

export const MAX_MOVING = 3;
export const MAX_FLASHES_PER_SECOND = 3;
const TOLERANCE = 1;

const ROLE_TOKEN: Record<Exclude<Role, "highlight">, ColourToken> = {
  given: "ink",
  student: "student",
  misconception: "misconception",
  correct: "correct",
  structure: "ink-muted",
};

/** The smallest size a maths label draws at, as a share of the label: exponents are smaller. */
function scriptScale(nodes: readonly MathNode[]): number {
  let smallest = 1;
  for (const node of nodes) {
    if ("pow" in node) {
      smallest = Math.min(smallest, scriptScale(node.pow[0]), SCRIPT_SCALE);
    } else if ("frac" in node) {
      smallest = Math.min(smallest, scriptScale(node.frac[0]), scriptScale(node.frac[1]));
    } else if ("sqrt" in node) {
      smallest = Math.min(smallest, scriptScale(node.sqrt));
    }
  }
  return smallest;
}

function isText(element: SceneElement): element is TextElement {
  return element.type === "text";
}

/** Marks, highlights and background rules may sit over or under other things. */
function mayOverlap(element: SceneElement): boolean {
  return element.type === "mark" || element.role === "highlight" || element.layer === "background";
}

function frameProblems(layout: SceneLayout, beat: number): CheckProblem[] {
  const { format, width, height } = layout;
  const problems: CheckProblem[] = [];
  const add = (check: CheckName, ids: string[], message: string) =>
    problems.push({ check, format, beat, ids, message });
  const elements = layout.frames[beat]?.elements ?? [];
  const safe = safeArea(width, height);
  const canvas = { x: 0, y: 0, width, height };
  const byId = new Map(elements.map((element) => [element.id, element]));
  const minSize = minTextSize(format);

  for (const element of elements) {
    const box = bounds(element);
    if (!contains(canvas, box, TOLERANCE)) {
      add("off_canvas", [element.id], "goes past the edge of the canvas");
    } else if (element.layer !== "background" && !contains(safe, box, TOLERANCE)) {
      add("margins", [element.id], "sits inside the 6% safe margin");
    }
    if (!(ROLES as readonly string[]).includes(element.role)) {
      add("colour_roles", [element.id], `has no colour role (${String(element.role)})`);
    }
    if (isText(element)) {
      if (element.maths) {
        // Maths that KaTeX cannot draw would blank the scene in the browser: catch it here.
        try {
          katex.renderToString(mathsToTex(element.maths), KATEX_OPTIONS);
        } catch (error) {
          add("overflow", [element.id], `maths does not render: ${(error as Error).message}`);
        }
      }
      const smallest = element.size * (element.maths ? scriptScale(element.maths) : 1);
      if (smallest < minSize - 0.01) {
        add(
          "font_size",
          [element.id],
          `text at ${smallest.toFixed(1)} units is under the ${minSize.toFixed(1)} minimum`,
        );
      }
      if (element.inside) {
        const container = byId.get(element.inside);
        if (!container) {
          add(
            "overflow",
            [element.id],
            `sits inside ${element.inside}, which is not on the canvas`,
          );
        } else if (!contains(bounds(container), box, TOLERANCE)) {
          add("overflow", [element.id, element.inside], `does not fit inside ${element.inside}`);
        }
      }
    }
  }

  // Text never overlaps text, and never overlaps a shape it does not belong inside.
  const texts = elements.filter(isText);
  const shapes = elements.filter((element) => !isText(element) && !mayOverlap(element));
  texts.forEach((a, i) => {
    for (const b of texts.slice(i + 1)) {
      if (overlaps(bounds(a), bounds(b), TOLERANCE))
        add("overlap", [a.id, b.id], "text overlaps text");
    }
    for (const shape of shapes) {
      if (a.inside === shape.id) continue;
      if (overlaps(bounds(a), bounds(shape), TOLERANCE))
        add("overlap", [a.id, shape.id], "text overlaps a shape");
    }
  });

  // Colour is never the only signal: a faulty step also gets a mark and a text label.
  if (elements.some((element) => element.role === "misconception")) {
    const marked = elements.some(
      (element) => element.type === "mark" && element.role === "misconception",
    );
    const labelled = texts.some((element) => element.role === "misconception");
    if (!marked || !labelled) {
      add(
        "colour_roles",
        [],
        "a faulty step needs a pen mark and a text label as well as its colour",
      );
    }
  }
  return problems;
}

/** A colour blended over another, as a highlighter wash is over the paper. */
export function blend(under: string, over: string, amount: number): string {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(under, i) * (1 - amount) + channel(over, i) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** How strongly a filled shape tints the paper under it, as the renderer draws it. */
function tint(element: SceneElement): number {
  if (
    isText(element) ||
    element.type === "line" ||
    element.type === "arc" ||
    element.type === "mark"
  ) {
    return 0;
  }
  if (element.role === "highlight") return HIGHLIGHT_WASH;
  if (!("fill" in element) || !element.fill) return 0;
  return element.type === "polygon" && element.role === "structure" ? 1 : FILL_TINT;
}

const TOKEN_FOR: Record<Role, ColourToken> = { ...ROLE_TOKEN, highlight: "highlight" };

/**
 * Text on a tinted shape (a highlighter wash, or a filled bar part it sits inside) needs 4.5:1
 * against the blended colour, in both themes, not just against plain paper.
 */
function tintProblems(layout: SceneLayout): CheckProblem[] {
  const problems: CheckProblem[] = [];
  layout.frames.forEach((frame, beat) => {
    const tinted = frame.elements.filter((element) => tint(element) > 0);
    for (const element of frame.elements.filter(isText)) {
      const under = tinted.filter((shape) => overlaps(bounds(shape), bounds(element), TOLERANCE));
      if (under.length === 0) continue;
      for (const mode of ["light", "dark"] as Mode[]) {
        const palette = colours[mode];
        const fore = element.role === "highlight" ? palette.ink : palette[TOKEN_FOR[element.role]];
        for (const shape of under) {
          const back = blend(palette.paper, palette[TOKEN_FOR[shape.role]], tint(shape));
          const ratio = contrastRatio(fore, back);
          if (ratio < AA_BODY_TEXT) {
            problems.push({
              check: "contrast",
              format: layout.format,
              beat,
              ids: [element.id, shape.id],
              message: `${element.role} text on a ${shape.role} tint is ${ratio.toFixed(2)}:1 in ${mode}; needs ${AA_BODY_TEXT}:1 (use ink text, or no fill)`,
            });
            break;
          }
        }
      }
    }
  });
  return problems;
}

function contrastProblems(layout: SceneLayout): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const seen = new Set<string>();
  layout.frames.forEach((frame, beat) => {
    for (const element of frame.elements) {
      if (element.layer === "background" || (element.role === "highlight" && !isText(element)))
        continue;
      for (const mode of ["light", "dark"] as Mode[]) {
        const palette = colours[mode];
        const [fore, back, needed] = isText(element)
          ? element.role === "highlight"
            ? [palette.ink, palette.highlight, AA_BODY_TEXT]
            : [
                palette[ROLE_TOKEN[element.role as Exclude<Role, "highlight">]],
                palette.paper,
                AA_BODY_TEXT,
              ]
          : [
              palette[ROLE_TOKEN[element.role as Exclude<Role, "highlight">]],
              palette.paper,
              AA_LARGE_TEXT_AND_UI,
            ];
        const ratio = contrastRatio(fore, back);
        const key = `${element.role}:${isText(element)}:${mode}`;
        if (ratio < needed && !seen.has(key)) {
          seen.add(key);
          problems.push({
            check: "contrast",
            format: layout.format,
            beat,
            ids: [element.id],
            message: `${element.role} ${isText(element) ? "text" : "shape"} is ${ratio.toFixed(2)}:1 in ${mode}; needs ${needed}:1`,
          });
        }
      }
    }
  });
  return problems;
}

function sequenceProblems(layout: SceneLayout, timings: readonly BeatTiming[]): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const { format } = layout;
  const roleOf = new Map<string, Role>();
  layout.frames.forEach((frame, beat) => {
    const previous = new Map(
      (layout.frames[beat - 1]?.elements ?? []).map((element) => [element.id, element]),
    );
    const moving = frame.elements.filter((element) => {
      const before = previous.get(element.id);
      return before !== undefined && moves(before, element);
    });
    if (moving.length > MAX_MOVING) {
      problems.push({
        check: "moving_elements",
        format,
        beat,
        ids: moving.map((element) => element.id),
        message: `${moving.length} elements move at once; at most ${MAX_MOVING}`,
      });
    }
    for (const element of frame.elements) {
      const role = roleOf.get(element.id);
      if (role !== undefined && role !== element.role) {
        problems.push({
          check: "colour_roles",
          format,
          beat,
          ids: [element.id],
          message: `changes colour from ${role} to ${element.role}; a quantity keeps its colour`,
        });
      }
      roleOf.set(element.id, element.role);
    }
  });

  // Flash rate: each appearance or disappearance is a change; no more than 3 in any second.
  const ids = new Set(
    layout.frames.flatMap((frame) => frame.elements.map((element) => element.id)),
  );
  for (const id of ids) {
    const changes: number[] = [];
    let wasShown = false;
    layout.frames.forEach((frame, beat) => {
      const shown = frame.elements.some((element) => element.id === id);
      if (shown !== wasShown) changes.push(timings[beat]?.start ?? 0);
      wasShown = shown;
    });
    for (let i = 0; i + MAX_FLASHES_PER_SECOND < changes.length; i += 1) {
      if ((changes[i + MAX_FLASHES_PER_SECOND] ?? Infinity) - (changes[i] ?? 0) < 1000) {
        problems.push({
          check: "flash_rate",
          format,
          beat: -1,
          ids: [id],
          message: "appears and disappears more than 3 times a second",
        });
        break;
      }
    }
  }
  return problems;
}

/** Every problem with a built scene, in both formats. Empty means it may be served. */
export function checkScene(scene: BuiltScene): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const narrations = scene.spec.beats.map((beat) => beat.narration);
  const declared = scene.template.focusIds;
  for (const format of SCENE_FORMATS) {
    const layout = scene.layouts[format];
    layout.frames.forEach((frame, beat) => {
      problems.push(...frameProblems(layout, beat));
      for (const element of frame.elements) {
        if (!belongsTo(element.id, declared)) {
          problems.push({
            check: "focus",
            format,
            beat,
            ids: [element.id],
            message: "belongs to no declared focus id",
          });
        }
      }
      for (const id of scene.spec.beats[beat]?.focus ?? []) {
        if (!frame.elements.some((element) => belongsTo(element.id, [id]))) {
          problems.push({
            check: "focus",
            format,
            beat,
            ids: [id],
            message: "is the beat's focus but nothing of it is on the canvas",
          });
        }
      }
    });
    problems.push(...contrastProblems(layout), ...tintProblems(layout));
    for (const reducedMotion of [false, true]) {
      problems.push(...sequenceProblems(layout, beatTimings(narrations, { reducedMotion })));
    }
  }
  // The two motion settings report the same sequence problems; keep one of each.
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = JSON.stringify(problem);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function describeProblem(problem: CheckProblem): string {
  const where = problem.beat >= 0 ? `beat ${problem.beat + 1}` : "whole scene";
  return `${problem.check} (${problem.format}, ${where}) ${problem.ids.join(", ")}: ${problem.message}`;
}
