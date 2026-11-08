// pnpm scenes:check [scene keys...]: static checks, then keyframes in headless Chromium.
// Screenshots go to e2e-artifacts/scenes/<key>/. Exits 1 when any check fails.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "@eddy/schemas";
import {
  buildScene,
  checkScene,
  describeProblem,
  TEMPLATES,
  type ItemParams,
} from "@eddy/scenes/registry";
import { checkKeyframes, describeKeyframeProblem } from "./keyframes";

const wanted = process.argv.slice(2);
const templates = wanted.length ? TEMPLATES.filter((t) => wanted.includes(t.key)) : TEMPLATES;
if (wanted.length && templates.length !== wanted.length) {
  const known = TEMPLATES.map((t) => t.key).join(", ");
  console.error(`Unknown scene. Known: ${known}`);
  process.exit(1);
}

const scenes = templates.map((t) => buildScene(t, t.sample.item, t.sample.studentAnswer));
let failed = false;
for (const scene of scenes) {
  const problems = checkScene(scene);
  for (const problem of problems)
    console.log(`static: ${scene.template.key} ${describeProblem(problem)}`);
  failed ||= problems.length > 0;
}

const screenshots = fileURLToPath(new URL("../../../e2e-artifacts/scenes/", import.meta.url));
const problems = await checkKeyframes(scenes, { screenshots });
for (const problem of problems) console.log(`dom: ${describeKeyframeProblem(problem)}`);
failed ||= problems.length > 0;

// Every golden input too (8 real items per scene, extreme parameters included), drawn at the
// widest stage of each format, where the pixel tolerance is strictest. Light only: themes change
// colours, not boxes.
const inputs = JSON.parse(
  readFileSync(new URL("../../../evals/golden/scenes/inputs.json", import.meta.url), "utf8"),
) as Record<string, { params: ItemParams; studentAnswer: JsonValue }[]>;
const golden = templates.flatMap((t) =>
  (inputs[`${t.itemTemplate}:${t.misconception}`] ?? []).map((row) =>
    buildScene(t, row.params, row.studentAnswer),
  ),
);
const goldenProblems = await checkKeyframes(golden, {
  themes: ["light"],
  widths: { desktop: [1152], mobile: [343] },
});
for (const problem of goldenProblems) {
  console.log(`dom (golden): ${describeKeyframeProblem(problem)}`);
}
failed ||= goldenProblems.length > 0;

const frames = scenes.reduce(
  (sum, scene) => sum + scene.layouts.desktop.frames.length + scene.layouts.mobile.frames.length,
  0,
);
console.log(
  failed
    ? `Scene checks failed (${scenes.length} scenes).`
    : `${scenes.length} scenes passed static and DOM checks: ${frames} sample keyframes at 2 or 3 widths in light and dark, and ${golden.length} golden variants at the widest widths. Screenshots in e2e-artifacts/scenes/.`,
);
process.exit(failed ? 1 : 0);
