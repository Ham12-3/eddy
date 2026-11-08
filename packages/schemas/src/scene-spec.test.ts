import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sceneSpecJsonSchema } from "./json-schema";
import { sceneSpecSchema, specProblems, type SceneSpec } from "./scene-spec";

// The example in SPEC.md section 8.1.
const example: SceneSpec = {
  schema: "scene-spec/1",
  template: "bar_model.share_in_ratio@1",
  misconception: "RATIO_DIVIDE_BY_EACH_PART",
  params: { total: 45, ratio: [2, 3], unit: "GBP" },
  studentAnswer: ["List", 22.5, 15],
  correctAnswer: ["List", 18, 27],
  beats: [
    {
      kind: "show_given",
      focus: ["total", "ratio"],
      narration: "We need to share £45 in the ratio 2 to 3.",
    },
    {
      kind: "show_student_working",
      focus: ["student.split"],
      narration: "You worked out 45 divided by 2, and 45 divided by 3.",
    },
    {
      kind: "reveal_correct",
      focus: ["answer"],
      narration: "So 2 parts is £18 and 3 parts is £27. Together they make £45.",
    },
  ],
};

describe("sceneSpecSchema", () => {
  it("accepts the SPEC example", () => {
    expect(sceneSpecSchema.parse(example)).toEqual(example);
  });

  it("rejects coordinates, colours and unknown keys", () => {
    const withColour = { ...example, beats: [{ ...example.beats[0], colour: "#ff0000" }] };
    expect(sceneSpecSchema.safeParse(withColour).success).toBe(false);
    expect(sceneSpecSchema.safeParse({ ...example, x: 10 }).success).toBe(false);
  });

  it("limits beats, beat kinds and template names", () => {
    const seven = { ...example, beats: Array.from({ length: 7 }, () => example.beats[0]) };
    expect(sceneSpecSchema.safeParse(seven).success).toBe(false);
    const badKind = { ...example, beats: [{ ...example.beats[0], kind: "explode" }] };
    expect(sceneSpecSchema.safeParse(badKind).success).toBe(false);
    expect(sceneSpecSchema.safeParse({ ...example, template: "bar_model" }).success).toBe(false);
  });

  it("reports long narration, dashes and undeclared elements", () => {
    const declared = new Set(["total", "ratio", "student.split"]);
    const long = "word ".repeat(26).trim();
    const spec: SceneSpec = {
      ...example,
      beats: [
        { kind: "show_given", focus: ["total"], narration: long },
        {
          kind: "compare",
          focus: ["ratio"],
          narration: `Two parts ${String.fromCodePoint(0x2013)} three parts.`,
        },
        { kind: "recap", focus: ["answer"], narration: "Done." },
      ],
    };
    expect(specProblems(spec, declared).map((p) => p.path)).toEqual([
      "beats.0.narration",
      "beats.1.narration",
      "beats.2.focus",
    ]);
    expect(specProblems(example, new Set([...declared, "answer"]))).toEqual([]);
  });
});

describe("narration that hides from the checks", () => {
  const declared = new Set(["total", "ratio", "student.split", "answer"]);
  const withNarration = (narration: string): SceneSpec => ({
    ...example,
    beats: [{ kind: "show_given", focus: ["total"], narration }],
  });

  it("counts words joined by zero-width spaces", () => {
    const joined = Array.from({ length: 30 }, () => "word").join(String.fromCodePoint(0x200b));
    expect(specProblems(withNarration(joined), declared).map((p) => p.message)).toContain(
      "30 words; at most 25",
    );
  });

  it("rejects bidi overrides and other invisible characters", () => {
    const flipped = `Share ${String.fromCodePoint(0x202e)}54£ in the ratio 2 to 3.`;
    expect(specProblems(withNarration(flipped), declared).map((p) => p.message)).toContain(
      "contains a control or invisible character",
    );
  });

  it("rejects every kind of dash", () => {
    for (const code of [0x2012, 0x2013, 0x2014, 0x2015]) {
      const text = `Two parts ${String.fromCodePoint(code)} three parts.`;
      expect(specProblems(withNarration(text), declared).map((p) => p.message)).toEqual([
        "contains a dash",
      ]);
    }
  });

  it("refuses blame, gushing, exclamation marks and emoji, but not degrees", () => {
    const messages = (text: string) =>
      specProblems(withNarration(text), declared).map((p) => p.message);
    expect(messages("You were careless here.")).toEqual([
      'says "careless"; name the slip, never the student',
    ]);
    expect(messages("Don't worry about it.").join(" ")).toMatch(/don't worry/i);
    expect(messages("Look at the bar!")).toEqual(["contains an exclamation mark"]);
    expect(messages(`Nice ${String.fromCodePoint(0x1f600)}`)).toEqual(["contains an emoji"]);
    expect(
      messages(
        `The angles are 89${String.fromCodePoint(0xb0)} and 91${String.fromCodePoint(0xb0)}.`,
      ),
    ).toEqual([]);
    expect(messages("Adjust the scale.")).toEqual([]);
  });

  it("accepts a version written in ASCII digits only", () => {
    const arabic = String.fromCodePoint(0x661);
    expect(
      sceneSpecSchema.safeParse({ ...example, template: `bar_model.share_in_ratio@${arabic}` })
        .success,
    ).toBe(false);
  });
});

describe("generated JSON Schema", () => {
  it("is up to date (run pnpm schemas:generate after changing the schema)", () => {
    const file = fileURLToPath(new URL("../generated/scene-spec.schema.json", import.meta.url));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(sceneSpecJsonSchema());
  });
});
