/**
 * Logic for the Stop hook (PLAN.md M0): typecheck and unit-test whatever the working tree changed,
 * and block the end of the turn while any check fails.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const MAX_CONSECUTIVE_BLOCKS = 3;

const TS_PACKAGES = [
  ["apps/web/", "@eddy/web"],
  ["packages/ui/", "@eddy/ui"],
  ["packages/scenes/", "@eddy/scenes"],
  ["packages/schemas/", "@eddy/schemas"],
  ["packages/api-client/", "@eddy/api-client"],
  ["workers/scene-check/", "@eddy/scene-check"],
  ["infra/", "@eddy/infra"],
];
const WORKSPACE_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);
const PYTHON_ROOT_FILES = new Set(["pyproject.toml", "uv.lock"]);

/** Paths changed in the working tree (staged, unstaged and untracked), relative to the repo root. */
export function changedFiles(root) {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-uall"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""));
}

/**
 * A fingerprint of the changed files' contents. If it matches the last run that passed, nothing
 * has changed since, and the checks can be skipped (so question-only turns stay fast).
 */
export function fingerprint(root, files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(`${file}\0`);
    const path = join(root, file);
    if (existsSync(path) && statSync(path).isFile()) hash.update(readFileSync(path));
    else hash.update("<deleted>");
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** The check commands needed for a set of changed paths. Dependents of a changed package are included. */
export function planChecks(files) {
  const paths = files.map((file) => file.replace(/\\/g, "/"));
  const changed = (test) => paths.some(test);
  const commands = [];

  if (changed((p) => WORKSPACE_FILES.has(p))) {
    commands.push("pnpm typecheck", "pnpm -r test");
  } else {
    for (const [prefix, name] of TS_PACKAGES) {
      if (changed((p) => p.startsWith(prefix))) {
        commands.push(`pnpm --filter "...${name}" typecheck`, `pnpm --filter "...${name}" test`);
      }
    }
    if (changed((p) => p.startsWith("e2e/") || p === "playwright.config.ts")) {
      commands.push("pnpm exec tsc -p tsconfig.json");
    }
  }
  if (changed((p) => p.startsWith("services/") || PYTHON_ROOT_FILES.has(p))) {
    commands.push("uv run mypy", "uv run pytest");
  }
  if (changed((p) => p.startsWith(".claude/hooks/"))) {
    commands.push('node --test ".claude/hooks/*.test.mjs"');
  }
  return commands;
}

/** Runs each command in a shell; returns the failures with the tail of their output. */
export function runChecks(commands, root, env = process.env) {
  const failures = [];
  for (const command of commands) {
    const result = spawnSync(command, {
      cwd: root,
      env,
      shell: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n");
      failures.push({ command, tail: output.slice(-30).join("\n") });
    }
  }
  return failures;
}
