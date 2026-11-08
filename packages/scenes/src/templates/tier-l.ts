import {
  MAX_BEATS,
  sceneSpecSchema,
  type Beat,
  type BeatKind,
  type JsonValue,
  type SceneSpec,
} from "@eddy/schemas";
import { checkScene, describeProblem } from "../checks/static-checks";
import { mathsToWords } from "../layout/measure";
import {
  focusOf,
  sceneFromSpec,
  type BuiltScene,
  type ItemParams,
  type SceneTemplate,
} from "./template";

/**
 * Tier L (SPEC.md section 7.2, ADR-0030). Claude writes only the beats: their kinds, what each one
 * points at and the narration. The server keeps the template, misconception, parameters and both
 * answers from the Tier D spec, so a model can change how a mistake is explained, never which
 * mistake or which numbers.
 */

/** What Claude is told about one scene, and what maths-core checks its narration against. */
export interface TierLContext {
  /** "number_line.compare_negatives@1". */
  template: string;
  title: string;
  misconception: string;
  focusIds: readonly string[];
  beatKinds: readonly BeatKind[];
  /** The reviewed Tier D spec for this item: the example Claude starts from. */
  tierD: SceneSpec;
  /** What each element shows on screen at the end of the reviewed scene. */
  elements: Record<string, string[]>;
  claims: JsonValue[];
  predicted: JsonValue;
}

export function tierLContext<P>(
  template: SceneTemplate<P>,
  item: ItemParams,
  studentAnswer: JsonValue,
): TierLContext {
  const params = template.params(item);
  const tierD = template.spec(params, item, studentAnswer);
  return {
    template: `${template.key}@${template.version}`,
    title: template.title,
    misconception: template.misconception,
    focusIds: template.focusIds,
    beatKinds: template.beatKinds,
    tierD,
    elements: elementsShown(sceneFromSpec(template, tierD)),
    claims: template.claims(params, studentAnswer),
    predicted: template.predicted(params),
  };
}

/** Beat kinds that only ask or sum up: they point at what is drawn and show nothing new. */
export const NOTHING_NEW_KINDS: readonly BeatKind[] = ["ask_prediction", "recap"];
/** The most a Tier L spec may weigh as JSON (ADR-0028's list before M6). */
export const MAX_SPEC_BYTES = 8 * 1024;

/**
 * Rules for a model's beats that the schema cannot say. Problems are sentences, because they go
 * back to Claude as feedback.
 *
 * - Each element is first shown in the template's order (a beat may show several at once, and may
 *   point again at earlier ones), and every element is shown by the end.
 * - A prediction question or a recap shows nothing new, so a question never gives its answer away.
 * - Exactly one beat is `reveal_correct`, and the template's last element (the answer) is first
 *   shown there, not before.
 */
export function beatOrderProblems(template: SceneTemplate, beats: readonly Beat[]): string[] {
  const problems: string[] = [];
  if (beats.length === 0 || beats.length > MAX_BEATS) {
    problems.push(`Write from 1 to ${MAX_BEATS} beats, not ${beats.length}.`);
  }
  const order = template.focusIds;
  const answer = order.at(-1);
  const revealed = new Set<string>();
  let furthest = -1;
  beats.forEach((beat, i) => {
    const fresh: number[] = [];
    for (const id of beat.focus) {
      const at = order.indexOf(id);
      if (at < 0) problems.push(`Beat ${i + 1}: "${id}" is not an element of this scene.`);
      else if (!revealed.has(id) && !fresh.includes(at)) fresh.push(at);
    }
    fresh.sort((a, b) => a - b);
    const first = fresh[0];
    if (first !== undefined && first < furthest) {
      problems.push(
        `Beat ${i + 1} first shows "${order[first]}" after "${order[furthest]}". Show the elements for the first time in this order: ${order.join(", ")}.`,
      );
    }
    if (fresh.length > 0 && NOTHING_NEW_KINDS.includes(beat.kind)) {
      problems.push(
        `Beat ${i + 1} is a "${beat.kind}" beat, so it must only point at elements already shown.`,
      );
    }
    const showsAnswer = fresh.some((at) => order[at] === answer);
    if (showsAnswer && beat.kind !== "reveal_correct") {
      problems.push(
        `Beat ${i + 1} first shows "${answer}", the answer: only the reveal_correct beat may show it.`,
      );
    }
    for (const at of fresh) revealed.add(order[at] as string);
    furthest = Math.max(furthest, ...fresh);
  });
  const missing = order.filter((id) => !revealed.has(id));
  if (missing.length > 0) {
    problems.push(
      `Every element must be shown by the last beat. Not shown: ${missing.join(", ")}.`,
    );
  }
  const reveals = beats.filter((beat) => beat.kind === "reveal_correct").length;
  if (reveals !== 1) {
    problems.push(`Exactly one beat must be a "reveal_correct" beat, not ${reveals}.`);
  }
  return problems;
}

/**
 * What each element shows on screen at the end of the reviewed scene, as words: its text and pen
 * marks (axis and scale labels left out). Claude reads it to know what each id draws.
 */
export function elementsShown(scene: BuiltScene): Record<string, string[]> {
  const shown: Record<string, string[]> = {};
  const frame = scene.layouts.desktop.frames.at(-1);
  for (const element of frame?.elements ?? []) {
    const focus = focusOf(element.id);
    let words: string | undefined;
    if (element.type === "text" && element.role !== "structure") {
      words = element.maths ? mathsToWords(element.maths) : element.text;
    } else if (element.type === "mark") {
      words = `${element.kind} mark (${element.role})`;
    }
    if (!words) continue;
    const list = (shown[focus] ??= []);
    if (!list.includes(words)) list.push(words);
  }
  return shown;
}

/** Every canvas label a scene shows, as words, except axis and scale labels (their own scale). */
export function sceneLabels(scene: BuiltScene): string[] {
  const labels = new Set<string>();
  for (const layout of Object.values(scene.layouts)) {
    for (const frame of layout.frames) {
      for (const element of frame.elements) {
        if (element.type !== "text" || element.role === "structure") continue;
        labels.add(element.maths ? mathsToWords(element.maths) : (element.text ?? ""));
      }
    }
  }
  return [...labels].sort();
}

/** A schema problem in the same words as the other checks: beats counted from 1. */
function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  const [first, index, ...rest] = issue.path.map(String);
  if (first === "beats" && index !== undefined && /^\d+$/.test(index)) {
    const where = rest.length ? ` ${rest.join(".")}` : "";
    return `Beat ${Number(index) + 1}${where}: ${issue.message}`;
  }
  return `${issue.path.map(String).join(".")}: ${issue.message}`;
}

export interface TierLCheck {
  /** The assembled spec (Tier D's with the model's beats), or null when it is not valid. */
  spec: SceneSpec | null;
  /** Sentences for Claude; empty when the spec passed every check this side of maths-core. */
  problems: string[];
  labels: string[];
}

/**
 * Assembles a Tier L spec from a model's beats and runs every check that needs the scene engine:
 * the schema, the narration rules, the template's vocabulary, the beat order, the layout in both
 * formats and the static checks. maths-core verifies the numbers afterwards.
 */
export function checkTierL<P>(
  template: SceneTemplate<P>,
  item: ItemParams,
  studentAnswer: JsonValue,
  beats: readonly Beat[],
): TierLCheck {
  const tierD = template.spec(template.params(item), item, studentAnswer);
  const candidate = {
    ...tierD,
    beats: beats.map(({ kind, focus, narration }) => ({ kind, focus, narration })),
  };
  const parsed = sceneSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    return { spec: null, problems: parsed.error.issues.map(describeIssue), labels: [] };
  }
  const problems = beatOrderProblems(template as SceneTemplate, parsed.data.beats);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed.data)).length;
  if (bytes > MAX_SPEC_BYTES) {
    problems.push(`The scene is ${bytes} bytes; keep it under ${MAX_SPEC_BYTES}.`);
  }
  let scene: BuiltScene;
  try {
    scene = sceneFromSpec(template, parsed.data);
  } catch (error) {
    problems.push(...(error as Error).message.split("; "));
    return { spec: null, problems, labels: [] };
  }
  for (const problem of checkScene(scene)) problems.push(describeProblem(problem));
  return { spec: scene.spec, problems, labels: sceneLabels(scene) };
}
