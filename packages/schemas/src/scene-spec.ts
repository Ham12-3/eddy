import { z } from "zod";

/**
 * SceneSpec v1 (SPEC.md section 8.1): what a scene says, never where things go. Templates and
 * Claude choose a template, element ids, beat kinds, parameters and narration; the layout engine
 * in @eddy/scenes decides every position and colour.
 *
 * This file is the source of truth. `pnpm schemas:generate` writes the JSON Schema to
 * `generated/scene-spec.schema.json` and the pydantic models in services/api from it. The
 * refinements below the object (word counts, dashes, element ids) are not expressible in JSON
 * Schema; services/api repeats them where it validates Claude's output (M6).
 */

export const BEAT_KINDS = [
  "show_given",
  "ask_prediction",
  "show_student_working",
  "highlight_slip",
  "build",
  "transform",
  "compare",
  "reveal_correct",
  "recap",
] as const;

export const MAX_BEATS = 6;
export const MAX_NARRATION_WORDS = 25;
export const MAX_FOCUS = 6;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A JSON value: item parameters and answers in MathJSON. */
export const jsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      // Integers first, so generated models keep 13 as 13 rather than 13.0.
      z.int(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema),
    ]),
  )
  .meta({ id: "JsonValue" });

/** "bar.parts", "student.split", "answer": ids the template declares. */
export const elementIdSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)*$/)
  .max(64)
  .meta({ id: "ElementId" });

export const beatSchema = z
  .object({
    kind: z.enum(BEAT_KINDS),
    focus: z.array(elementIdSchema).min(1).max(MAX_FOCUS),
    narration: z.string().min(1).max(240),
  })
  .strict()
  .meta({ id: "Beat" });

export const sceneSpecSchema = z
  .object({
    schema: z.literal("scene-spec/1"),
    /** "bar_model.share_in_ratio@1": primitive, scene and template version. */
    template: z
      .string()
      .regex(/^[a-z][a-z_]*\.[a-z][a-z_]*@[0-9]+$/)
      .max(80),
    misconception: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(64),
    params: z.record(z.string(), jsonValueSchema),
    studentAnswer: jsonValueSchema,
    correctAnswer: jsonValueSchema,
    beats: z.array(beatSchema).min(1).max(MAX_BEATS),
  })
  .strict()
  .meta({ id: "SceneSpec" });

export type Beat = z.infer<typeof beatSchema>;
export type BeatKind = (typeof BEAT_KINDS)[number];
export type SceneSpec = z.infer<typeof sceneSpecSchema>;

// Dashes from figure dash to horizontal bar, written as code points so this file has none.
const DASHES = new RegExp(`[${String.fromCodePoint(0x2012, 0x2013, 0x2014, 0x2015)}]`);
// Control and invisible formatting characters (bidi overrides, zero-width spaces): narration is
// shown to children and spoken, so what is checked must be what they see.
const INVISIBLE = /[\p{Cc}\p{Cf}]/u;
const ZERO_WIDTH = String.fromCodePoint(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff);
// An alternation, not a character class: a joiner inside a class reads as one joined character.
const WORD_GAP = new RegExp(`(?:\\s|${[...ZERO_WIDTH].join("|")})+`);

export function narrationWords(text: string): number {
  return text.split(WORD_GAP).filter(Boolean).length;
}

export interface SpecProblem {
  path: string;
  message: string;
}

/**
 * Checks beyond the schema: narration length and style, and that every focus id is one the
 * template declares. Empty when the spec is acceptable.
 */
export function specProblems(spec: SceneSpec, declaredIds: ReadonlySet<string>): SpecProblem[] {
  const problems: SpecProblem[] = [];
  spec.beats.forEach((beat, index) => {
    const path = `beats.${index}`;
    const words = narrationWords(beat.narration);
    if (words > MAX_NARRATION_WORDS) {
      problems.push({
        path: `${path}.narration`,
        message: `${words} words; at most ${MAX_NARRATION_WORDS}`,
      });
    }
    if (DASHES.test(beat.narration)) {
      problems.push({ path: `${path}.narration`, message: "contains a dash" });
    }
    if (INVISIBLE.test(beat.narration)) {
      problems.push({
        path: `${path}.narration`,
        message: "contains a control or invisible character",
      });
    }
    if (beat.narration !== beat.narration.normalize("NFC")) {
      problems.push({ path: `${path}.narration`, message: "is not in Unicode NFC form" });
    }
    for (const id of beat.focus) {
      if (!declaredIds.has(id)) {
        problems.push({ path: `${path}.focus`, message: `unknown element ${id}` });
      }
    }
  });
  return problems;
}
