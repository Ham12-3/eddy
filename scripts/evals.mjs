#!/usr/bin/env node
// Entry point for `pnpm evals` (SPEC.md section 7.6). Suites so far: maths accuracy (M3).
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
];

let failed = 0;
for (const suite of suites) {
  console.log(`Running ${suite.name}`);
  const result = spawnSync(suite.command, suite.args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    failed += 1;
    console.error(`${suite.name} failed`);
  }
}
process.exit(failed === 0 ? 0 : 1);
