#!/usr/bin/env node
// Stop hook: typecheck and unit-test the packages changed in the working tree. Exit code 2 blocks
// the end of the turn and sends the failures back to Claude. Checks are skipped when the changed
// files are byte-for-byte what they were at the last passing run. After 3 consecutive blocks in a
// session it lets the turn end and shows the user a warning, so a check that cannot be fixed never
// traps the session. EDDY_STOP_HOOK_DISABLE=1 (set before starting Claude Code) switches it off.
// EDDY_STOP_HOOK_COMMANDS (a JSON array) replaces the planned commands; the tests use it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_CONSECUTIVE_BLOCKS,
  changedFiles,
  fingerprint,
  planChecks,
  runChecks,
} from "./lib/stop.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");

if (process.env.EDDY_STOP_HOOK_DISABLE === "1") process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const sessionId = String(input.session_id ?? "unknown").replace(/[^\w-]/g, "");
const stateFile = join(
  process.env.EDDY_STOP_HOOK_STATE_DIR ?? tmpdir(),
  `eddy-stop-hook-${sessionId}.json`,
);
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, "utf8"))
  : { blocks: 0, lastPassed: null };
const save = (next) => writeFileSync(stateFile, JSON.stringify(next));

let commands;
let print;
if (process.env.EDDY_STOP_HOOK_COMMANDS) {
  commands = JSON.parse(process.env.EDDY_STOP_HOOK_COMMANDS);
  print = fingerprint(root, []) + JSON.stringify(commands);
} else {
  const files = changedFiles(root);
  commands = planChecks(files);
  print = fingerprint(root, files);
}

if (commands.length === 0 || print === state.lastPassed) process.exit(0);

const failures = runChecks(commands, root);
if (failures.length === 0) {
  save({ blocks: 0, lastPassed: print });
  process.exit(0);
}

const blocks = state.blocks + 1;
const report = failures.map(({ command, tail }) => `$ ${command}\n${tail}`).join("\n\n");

if (blocks > MAX_CONSECUTIVE_BLOCKS) {
  save({ blocks: 0, lastPassed: state.lastPassed });
  const failing = failures.map(({ command }) => command).join(", ");
  // On exit 0 only stdout JSON reaches anyone; systemMessage is shown to the user.
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Eddy Stop hook: checks are still failing after ${MAX_CONSECUTIVE_BLOCKS} attempts and the turn was allowed to end. Failing: ${failing}`,
    }),
  );
  process.exit(0);
}

save({ blocks, lastPassed: state.lastPassed });
process.stderr.write(
  `Checks failed for changed packages (attempt ${blocks} of ${MAX_CONSECUTIVE_BLOCKS}). ` +
    `Fix them before finishing:\n\n${report}\n`,
);
process.exit(2);
