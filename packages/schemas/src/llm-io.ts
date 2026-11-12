import { z } from "zod";

/**
 * Every structured Claude output outside scenes (SPEC.md sections 5.2, 9 and 7.4). This file is
 * the source of truth: `pnpm schemas:generate` writes the JSON Schema and the pydantic models in
 * services/api (`eddy_api.llm.io`), which validate every answer Claude gives. Checks a schema
 * cannot say (word counts, answer leaks, maths) run in services/api.
 */

// The tutor (SPEC.md section 9.1).

export const TUTOR_MESSAGE_KINDS = [
  "question",
  "hint",
  "feedback",
  "worked_example_parallel",
  "redirect",
] as const;
/** Words in a tutor message, and in a worked example of a parallel problem. */
export const MAX_TUTOR_WORDS = 60;
export const MAX_WORKED_EXAMPLE_WORDS = 150;
/** 0 none, 1 nudge, 2 pointed question, 3 partial worked step, 4 parallel worked example. */
export const MAX_HINT_LEVEL = 4;

/**
 * MathJSON nested at most four arrays deep, as real JSON. Structured output cannot take a
 * recursive schema, and as a string of JSON the model often stopped after "[", so each level is
 * spelled out. maths-core checks every expression against its allow-list.
 */
// Integers first, so 13 stays an integer (exact maths), not 13.0.
const mathAtom = z.union([z.int(), z.number(), z.string().max(40)]).meta({ id: "MathAtom" });
const mathNode1 = z.array(mathAtom).max(12).meta({ id: "MathNode1" });
const mathNode2 = z
  .array(z.union([mathAtom, mathNode1]))
  .max(12)
  .meta({ id: "MathNode2" });
const mathNode3 = z
  .array(z.union([mathAtom, mathNode2]))
  .max(12)
  .meta({ id: "MathNode3" });
const mathNode4 = z
  .array(z.union([mathAtom, mathNode3]))
  .max(12)
  .meta({ id: "MathNode4" });
export const tutorExprSchema = z.union([mathAtom, mathNode4]);

export const tutorMathSchema = z
  .object({
    expr: tutorExprSchema,
    role: z.enum(["given", "claim", "step"]),
  })
  .strict()
  .meta({ id: "TutorMath" });

export const tutorMessageSchema = z
  .object({
    text: z.string().min(1).max(1200),
    kind: z.enum(TUTOR_MESSAGE_KINDS),
    hint_level: z.int().min(0).max(MAX_HINT_LEVEL),
    /** Every expression the text states, as MathJSON, for maths-core to verify. */
    maths: z.array(tutorMathSchema).max(12),
    /**
     * True when the student's words suggest they may be unsafe, hurt or in distress: Eddy's code
     * then stops the lesson and shows the safeguarding script (a check behind the classifier).
     */
    concern: z.boolean(),
  })
  .strict()
  .meta({ id: "TutorMessage" });

// The safety classifiers (SPEC.md section 9.2, steps 3 and 6).

export const SAFEGUARDING_LEVELS = ["none", "concern", "immediate"] as const;
export const SAFEGUARDING_CATEGORIES = [
  "self_harm",
  "suicidal_thoughts",
  "abuse",
  "neglect",
  "exploitation",
  "bullying",
  "danger",
  "distress",
  "other",
] as const;

export const inputVerdictSchema = z
  .object({
    safeguarding: z.enum(SAFEGUARDING_LEVELS),
    safeguarding_category: z.enum([...SAFEGUARDING_CATEGORIES, "none"]),
    harmful_request: z.boolean(),
    off_topic: z.boolean(),
    prompt_injection: z.boolean(),
    answer_demand: z.boolean(),
    /** The student asks for help with the question, or says they are stuck. */
    help_request: z.boolean(),
  })
  .strict()
  .meta({ id: "InputVerdict" });

export const outputVerdictSchema = z
  .object({
    safe: z.boolean(),
    kind_and_respectful: z.boolean(),
    gives_away_answer: z.boolean(),
    problems: z.array(z.string().max(500)).max(5),
  })
  .strict()
  .meta({ id: "OutputVerdict" });

// The pedagogy eval judge (SPEC.md section 7.6).

export const RUBRIC = [
  "no_answer_given",
  "misconception_addressed",
  "one_question_at_a_time",
  "warmth",
  "concise",
  "uk_english",
  "safeguarding_handled",
  "responds_to_student",
  "hint_ladder",
] as const;

export const rubricScoreSchema = z
  .object({
    /** 1 poor to 4 excellent; 0 when the criterion does not apply to this conversation. */
    score: z.int().min(0).max(4),
    reason: z.string().max(1000),
  })
  .strict()
  .meta({ id: "RubricScore" });

/** One field per criterion, so the judge scores each exactly once. */
export const pedagogyJudgementSchema = z
  .object({
    no_answer_given: rubricScoreSchema,
    misconception_addressed: rubricScoreSchema,
    one_question_at_a_time: rubricScoreSchema,
    warmth: rubricScoreSchema,
    concise: rubricScoreSchema,
    uk_english: rubricScoreSchema,
    safeguarding_handled: rubricScoreSchema,
    responds_to_student: rubricScoreSchema,
    hint_ladder: rubricScoreSchema,
  } satisfies Record<(typeof RUBRIC)[number], typeof rubricScoreSchema>)
  .strict()
  .meta({ id: "PedagogyJudgement" });

// English marking (Loop 4 scaffolding, SPEC.md section 7.4): the output shape only, no model yet.

export const englishAssessmentSchema = z
  .object({
    /** The assessment objective, as the board's mark scheme numbers it ("AO1"). */
    objective: z.string().regex(/^AO[1-6]$/),
    level: z.int().min(0).max(6),
    /** Short quotations from the student's answer that support the level. */
    evidence: z.array(z.string().max(200)).max(5),
    comment: z.string().max(400),
  })
  .strict()
  .meta({ id: "EnglishAssessment" });

export const englishMarkingSchema = z
  .object({
    question_type: z.string().max(64),
    marks: z.int().min(0).max(40),
    max_marks: z.int().min(1).max(40),
    overall_level: z.int().min(0).max(6),
    assessments: z.array(englishAssessmentSchema).max(6),
    next_step: z.string().max(400),
  })
  .strict()
  .meta({ id: "EnglishMarking" });

export type TutorMessage = z.infer<typeof tutorMessageSchema>;
export type InputVerdict = z.infer<typeof inputVerdictSchema>;
export type OutputVerdict = z.infer<typeof outputVerdictSchema>;
export type PedagogyJudgement = z.infer<typeof pedagogyJudgementSchema>;
export type EnglishMarking = z.infer<typeof englishMarkingSchema>;

/** One schema document holding every model, so one generated pydantic module covers them. */
export const llmIoSchema = z
  .object({
    tutorMessage: tutorMessageSchema,
    inputVerdict: inputVerdictSchema,
    outputVerdict: outputVerdictSchema,
    pedagogyJudgement: pedagogyJudgementSchema,
    englishMarking: englishMarkingSchema,
  })
  .strict();
