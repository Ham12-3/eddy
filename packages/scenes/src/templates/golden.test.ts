import type { JsonValue } from "@eddy/schemas";
import { describe, expect, it } from "vitest";
import { checkScene, describeProblem } from "../checks/static-checks";
import { TEMPLATES } from "./registry";
import { buildScene, type ItemParams } from "./template";
import inputsJson from "../../../../evals/golden/scenes/inputs.json" with { type: "json" };

/** Every default scene, built from eight real items (evals/golden/scenes/inputs.json). */

interface Input {
  seed: number;
  params: ItemParams;
  studentAnswer: JsonValue;
}

const inputs = inputsJson as unknown as Record<string, Input[]>;

describe.each(TEMPLATES.map((template) => [template.key, template] as const))(
  "%s",
  (_, template) => {
    const rows = inputs[`${template.itemTemplate}:${template.misconception}`] ?? [];

    it("has golden inputs", () => {
      expect(rows.length).toBeGreaterThanOrEqual(8);
    });

    it.each(rows.map((row) => [row.seed, row] as const))(
      "builds and passes every check for seed %i",
      (_, row) => {
        const scene = buildScene(template, row.params, row.studentAnswer);
        expect(checkScene(scene).map(describeProblem)).toEqual([]);
        expect(
          template.claims(template.params(row.params), row.studentAnswer).length,
        ).toBeGreaterThan(0);
      },
    );

    it("builds its gallery sample", () => {
      const scene = buildScene(template, template.sample.item, template.sample.studentAnswer);
      expect(scene.spec.beats.length).toBeGreaterThan(0);
    });
  },
);
