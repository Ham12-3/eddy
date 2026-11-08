import type { Beat, JsonValue } from "@eddy/schemas";
import { describe, expect, it } from "vitest";
import { TEMPLATES, TEMPLATES_BY_KEY } from "./registry";
import { beatOrderProblems, checkTierL, tierLContext } from "./tier-l";
import type { ItemParams, SceneTemplate } from "./template";
import inputsJson from "../../../../evals/golden/scenes/inputs.json" with { type: "json" };

interface Input {
  seed: number;
  params: ItemParams;
  studentAnswer: JsonValue;
}
const inputs = inputsJson as unknown as Record<string, Input[]>;

describe("Tier D scenes follow the Tier L rules", () => {
  it.each(TEMPLATES.map((t) => [t.key, t] as const))("%s, every golden item", (_, template) => {
    const rows = inputs[`${template.itemTemplate}:${template.misconception}`] ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const context = tierLContext(template, row.params, row.studentAnswer);
      expect(context.tierD.beats.every((beat) => template.beatKinds.includes(beat.kind))).toBe(
        true,
      );
      const check = checkTierL(template, row.params, row.studentAnswer, context.tierD.beats);
      expect(check.problems).toEqual([]);
      expect(check.labels.length).toBeGreaterThan(0);
    }
  });
});

describe("a model's beats", () => {
  const template = TEMPLATES_BY_KEY.get("number_line.compare_negatives") as SceneTemplate;
  const { item, studentAnswer } = template.sample;
  const tierD = tierLContext(template, item, studentAnswer).tierD.beats;
  const check = (beats: Beat[]) => checkTierL(template, item, studentAnswer, beats).problems;

  it("may reword the narration and merge beats", () => {
    const merged: Beat[] = [
      {
        ...tierD[0]!,
        focus: ["question", "student"],
        narration: "Which is smaller? You chose the number with the smaller digit.",
      },
      ...tierD.slice(2),
    ];
    expect(check(merged)).toEqual([]);
  });

  it("must show the elements in the template's order", () => {
    const swapped = [tierD[0]!, tierD[1]!, tierD[3]!, tierD[2]!, tierD[4]!];
    expect(check(swapped).join(" ")).toMatch(/first shows "line" after "slip"/);
  });

  it("must show every element and reveal the answer", () => {
    const problems = check(tierD.slice(0, 4));
    expect(problems.join(" ")).toMatch(/Not shown: answer/);
    expect(problems.join(" ")).toMatch(/reveal_correct/);
  });

  it("may point again at an element it has shown", () => {
    const recap: Beat = {
      kind: "recap",
      focus: ["line"],
      narration: "Left is smaller on a number line.",
    };
    expect(check([...tierD, recap].slice(0, 6))).toEqual([]);
  });

  it("cannot invent an element or use a beat kind the template lacks", () => {
    expect(beatOrderProblems(template, [{ ...tierD[0]!, focus: ["chart"] }]).join(" ")).toMatch(
      /"chart" is not an element/,
    );
    const odd = { ...template, beatKinds: template.beatKinds.filter((k) => k !== "recap") };
    const recap: Beat = { kind: "recap", focus: ["line"], narration: "Left is smaller." };
    expect(checkTierL(odd, item, studentAnswer, [...tierD, recap]).problems.join(" ")).toMatch(
      /no "recap" beat/,
    );
  });

  it("keeps the narration rules: words, dashes and length", () => {
    const long = { ...tierD[0]!, narration: "word ".repeat(26).trim() };
    expect(check([long, ...tierD.slice(1)]).join(" ")).toMatch(/26 words/);
    const dashed = {
      ...tierD[0]!,
      narration: `Which is smaller ${String.fromCodePoint(0x2014)} this one?`,
    };
    expect(check([dashed, ...tierD.slice(1)]).join(" ")).toMatch(/dash/);
    expect(check([]).length).toBeGreaterThan(0);
  });

  it("keeps the template, misconception, parameters and answers from Tier D", () => {
    const result = checkTierL(template, item, studentAnswer, tierD);
    const expected = tierLContext(template, item, studentAnswer).tierD;
    expect(result.spec).toMatchObject({
      template: expected.template,
      misconception: expected.misconception,
      params: expected.params,
      correctAnswer: expected.correctAnswer,
    });
  });
});

describe("the stricter Tier L rules", () => {
  const template = TEMPLATES_BY_KEY.get("number_line.compare_negatives") as SceneTemplate;
  const { item, studentAnswer } = template.sample;
  const tierD = tierLContext(template, item, studentAnswer).tierD.beats;
  const check = (beats: Beat[]) => checkTierL(template, item, studentAnswer, beats).problems;

  it("a prediction question shows nothing new", () => {
    const asking: Beat = {
      kind: "ask_prediction",
      focus: ["line"],
      narration: "Where do you think the numbers go?",
    };
    expect(check([tierD[0]!, tierD[1]!, asking, ...tierD.slice(3)]).join(" ")).toMatch(
      /"ask_prediction" beat, so it must only point at elements already shown/,
    );
  });

  it("only the reveal_correct beat shows the answer, and there is exactly one", () => {
    const early = [tierD[0]!, tierD[1]!, tierD[2]!, { ...tierD[3]!, focus: ["slip", "answer"] }];
    const problems = check([...early, { ...tierD[4]!, focus: ["line"] }]).join(" ");
    expect(problems).toMatch(/only the reveal_correct beat may show it/);
    const twice = check([...tierD, { ...tierD[4]!, focus: ["line"] }]).join(" ");
    expect(twice).toMatch(/Exactly one beat must be a "reveal_correct" beat, not 2/);
  });

  it("counts beats from 1 in schema problems", () => {
    const empty = { ...tierD[0]!, focus: [] };
    expect(check([empty, ...tierD.slice(1)]).join(" ")).toMatch(/^Beat 1 focus:/);
  });

  it("tells Claude what each element shows", () => {
    const { elements } = tierLContext(template, item, studentAnswer);
    expect(Object.keys(elements)).toEqual(expect.arrayContaining(["question", "slip", "answer"]));
    expect(elements.slip?.some((words) => words.includes("mark"))).toBe(true);
  });
});
