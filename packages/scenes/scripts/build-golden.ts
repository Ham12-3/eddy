// pnpm --filter @eddy/scenes golden: builds every default scene from the golden inputs
// (evals/golden/scenes/inputs.json, written by maths-core) and writes specs.jsonl: each spec, its
// claims and its canvas labels, for `python -m eddy_maths_core.scene_golden check`. Fails if any
// scene does not build or fails a static check.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@eddy/schemas";
import { checkScene, describeProblem } from "../src/checks/static-checks";
import { TEMPLATES } from "../src/templates/registry";
import { buildScene, type ItemParams } from "../src/templates/template";
import { sceneLabels } from "../src/templates/tier-l";

interface Input {
  seed: number;
  params: ItemParams;
  answer: JsonValue;
  studentAnswer: JsonValue;
}

const folder = new URL("../../../evals/golden/scenes/", import.meta.url);
const inputs = JSON.parse(readFileSync(new URL("inputs.json", folder), "utf8")) as Record<
  string,
  Input[]
>;

const lines: string[] = [];
let failures = 0;
for (const template of TEMPLATES) {
  const rows = inputs[`${template.itemTemplate}:${template.misconception}`];
  if (!rows) {
    console.error(
      `${template.key}: no golden inputs for ${template.itemTemplate} and ${template.misconception}`,
    );
    failures += 1;
    continue;
  }
  for (const row of rows) {
    try {
      const scene = buildScene(template, row.params, row.studentAnswer);
      for (const problem of checkScene(scene)) {
        console.error(`${template.key} seed ${row.seed}: ${describeProblem(problem)}`);
        failures += 1;
      }
      const params = template.params(row.params);
      const claims = template.claims(params, row.studentAnswer);
      const predicted = template.predicted(params);
      lines.push(
        JSON.stringify({
          template: template.key,
          seed: row.seed,
          spec: scene.spec,
          answer: row.answer,
          predicted,
          claims,
          labels: sceneLabels(scene),
        }),
      );
    } catch (error) {
      console.error(`${template.key} seed ${row.seed}: ${(error as Error).message}`);
      failures += 1;
    }
  }
}

writeFileSync(fileURLToPath(new URL("specs.jsonl", folder)), `${lines.join("\n")}\n`, {
  encoding: "utf8",
});
console.log(
  `Wrote ${lines.length} scene specs to evals/golden/scenes/specs.jsonl (${failures} problems)`,
);
process.exit(failures === 0 ? 0 : 1);
