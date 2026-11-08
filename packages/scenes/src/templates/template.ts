import { sceneSpecSchema, specProblems, type JsonValue, type SceneSpec } from "@eddy/schemas";
import { CANVAS, SCENE_FORMATS, type SceneFormat } from "../canvas";
import type { SceneElement, SceneLayout } from "../layout/types";

export const PRIMITIVES = [
  "number_line",
  "bar_model",
  "balance",
  "coordinate_grid",
  "transformation_grid",
  "angle_diagram",
  "area_model",
  "pythagoras_squares",
  "probability_tree",
  "data_chart",
  "place_value_slider",
] as const;
export type Primitive = (typeof PRIMITIVES)[number];

export type ItemParams = Record<string, JsonValue>;

/**
 * A hand-authored, parametric scene (SPEC.md section 7.2, Tier D). Given an item's parameters and
 * the student's answer it writes a complete SceneSpec with no model call, and it draws the canvas
 * for any spec that uses its vocabulary, so a Tier L spec (M6) can reorder or drop beats.
 */
export interface SceneTemplate<P = unknown> {
  /** "number_line.compare_negatives": the primitive, then the scene. */
  key: string;
  version: number;
  primitive: Primitive;
  node: string;
  misconception: string;
  /** The maths-core item template whose parameters this scene explains. */
  itemTemplate: string;
  /** For the gallery and the static diagram's heading. */
  title: string;
  /** Ids a beat may focus on; every element the template draws belongs to one of them. */
  focusIds: readonly string[];
  /** Validates and reads the item's parameters. Throws when the scene cannot explain them. */
  params(item: ItemParams): P;
  /** Tier D: the whole spec, with narration from reviewed sentence templates. */
  spec(params: P, item: ItemParams, studentAnswer: JsonValue): SceneSpec;
  /** What is on the canvas once the `revealed` focus ids have been shown; `current` is this beat's. */
  draw(
    params: P,
    format: SceneFormat,
    revealed: ReadonlySet<string>,
    current: ReadonlySet<string>,
  ): SceneElement[];
  /**
   * The wrong answer this misconception gives for these parameters, as MathJSON. The scene
   * narrates it, so the golden check confirms it equals the student's actual answer.
   */
  predicted(params: P): JsonValue;
  /** Every maths fact the scene states, as MathJSON relations, for maths-core to verify. */
  claims(params: P, studentAnswer: JsonValue): JsonValue[];
  /** A worked example for the gallery, the tests and the keyframe checker. */
  sample: { item: ItemParams; studentAnswer: JsonValue };
}

export interface BuiltScene {
  template: SceneTemplate;
  spec: SceneSpec;
  layouts: Record<SceneFormat, SceneLayout>;
}

/** The frames for a spec: each beat reveals its focus ids, cumulatively. */
export function layoutScene<P>(
  template: SceneTemplate<P>,
  params: P,
  spec: SceneSpec,
  format: SceneFormat,
): SceneLayout {
  const revealed = new Set<string>();
  const frames = spec.beats.map((beat) => {
    for (const id of beat.focus) revealed.add(id);
    return { elements: template.draw(params, format, revealed, new Set(beat.focus)) };
  });
  return { format, ...CANVAS[format], frames };
}

/** Builds a spec's layouts after checking it against the schema and the template's vocabulary. */
export function sceneFromSpec<P>(template: SceneTemplate<P>, spec: SceneSpec): BuiltScene {
  const parsed = sceneSpecSchema.parse(spec);
  if (parsed.template !== `${template.key}@${template.version}`) {
    throw new Error(`Spec is for ${parsed.template}, not ${template.key}@${template.version}`);
  }
  const problems = specProblems(parsed, new Set(template.focusIds));
  if (problems.length > 0) {
    throw new Error(problems.map((p) => `${p.path}: ${p.message}`).join("; "));
  }
  const params = template.params(parsed.params);
  const layouts = Object.fromEntries(
    SCENE_FORMATS.map((format) => [format, layoutScene(template, params, parsed, format)]),
  ) as Record<SceneFormat, SceneLayout>;
  return { template: template as SceneTemplate, spec: parsed, layouts };
}

/** Tier D: a complete scene from an item and the student's answer, with no model call. */
export function buildScene<P>(
  template: SceneTemplate<P>,
  item: ItemParams,
  studentAnswer: JsonValue,
): BuiltScene {
  return sceneFromSpec(template, template.spec(template.params(item), item, studentAnswer));
}

/** Whether an element id belongs to one of the given focus ids ("bar.parts.1" to "bar.parts"). */
export function belongsTo(elementId: string, focusIds: Iterable<string>): boolean {
  for (const id of focusIds) {
    if (elementId === id || elementId.startsWith(`${id}.`)) return true;
  }
  return false;
}

/** The focus id an element belongs to: the first part of its id ("bar.part.1" to "bar"). */
export function focusOf(elementId: string): string {
  return elementId.split(".")[0] as string;
}
