#!/usr/bin/env node
// Entry point for `pnpm evals` (SPEC.md section 7.6). Suites so far: maths accuracy (M3) and the
// default scenes' maths (M5): 300 golden items and about 100 scene specs, all 100% verified.
import { spawnSync } from "node:child_process";

const suites = [
  {
    name: "maths golden set",
    command: "uv",
    args: [
      "run",
      "--package",
      "eddy-maths-core",
      "python",
      "-m",
      "eddy_maths_core.golden",
      "check",
      "evals/golden/maths/items.jsonl",
    ],
  },
  {
    // Builds every default scene from the golden inputs and rewrites specs.jsonl (CI then checks
    // the committed file is unchanged), so a narration change shows up in review.
    name: "scene specs build and pass static checks",
    command: "pnpm",
    args: ["--filter", "@eddy/scenes", "golden"],
    shell: process.platform === "win32",
  },
  {
    name: "scene maths verified",
    command: "uv",
    args: [
      "run",
      "--package",
      "eddy-maths-core",
      "python",
      "-m",
      "eddy_maths_core.scene_golden",
      "check",
      "evals/golden/scenes/specs.jsonl",
    ],
  },
];

let failed = 0;
for (const suite of suites) {
  console.log(`Running ${suite.name}`);
  const result = spawnSync(suite.command, suite.args, {
    stdio: "inherit",
    shell: suite.shell ?? false,
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`${suite.name} failed`);
  }
}
process.exit(failed === 0 ? 0 : 1);
