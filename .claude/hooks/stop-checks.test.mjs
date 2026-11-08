import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_CONSECUTIVE_BLOCKS, changedFiles, fingerprint, planChecks } from "./lib/stop.mjs";

const hookPath = join(dirname(fileURLToPath(import.meta.url)), "stop-checks.mjs");

describe("planChecks", () => {
  it("does nothing when nothing changed", () => {
    assert.deepEqual(planChecks([]), []);
  });

  it("checks a changed package and its dependents", () => {
    assert.deepEqual(planChecks(["packages/ui/src/contrast.ts"]), [
      'pnpm --filter "...@eddy/ui" typecheck',
      'pnpm --filter "...@eddy/ui" test',
    ]);
  });

  it("runs mypy and pytest for Python changes", () => {
    assert.deepEqual(planChecks(["services\\api\\src\\eddy_api\\auth.py"]), [
      "uv run mypy",
      "uv run pytest",
    ]);
  });

  it("checks everything when workspace files change", () => {
    assert.deepEqual(planChecks(["pnpm-lock.yaml"]), ["pnpm typecheck", "pnpm -r test"]);
  });

  it("tests the hooks when they change, and ignores docs", () => {
    assert.deepEqual(planChecks([".claude/hooks/lib/guard.mjs", "PLAN.md"]), [
      'node --test ".claude/hooks/*.test.mjs"',
    ]);
  });
});

describe("changedFiles and fingerprint", () => {
  const repo = mkdtempSync(join(tmpdir(), "eddy-stop-hook-repo-"));
  after(() => rmSync(repo, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");

  it("lists untracked and modified files", () => {
    assert.deepEqual(changedFiles(repo), ["a.ts"]);
  });

  it("changes when a changed file's content changes, and only then", () => {
    const before = fingerprint(repo, changedFiles(repo));
    assert.equal(fingerprint(repo, changedFiles(repo)), before);
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    assert.notEqual(fingerprint(repo, changedFiles(repo)), before);
  });
});

describe("hook process", () => {
  const scratch = mkdtempSync(join(tmpdir(), "eddy-stop-hook-test-"));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  // A deliberately failing test, run the way the hook runs real checks.
  const failingTest = join(scratch, "deliberately-failing.test.mjs");
  writeFileSync(
    failingTest,
    'import { test } from "node:test";\ntest("fails", () => { throw new Error("deliberate"); });\n',
  );
  const passingTest = join(scratch, "passing.test.mjs");
  writeFileSync(passingTest, 'import { test } from "node:test";\ntest("passes", () => {});\n');

  const run = (sessionId, testFile) => {
    const env = {
      ...process.env,
      EDDY_STOP_HOOK_COMMANDS: JSON.stringify([`node --test "${testFile}"`]),
      EDDY_STOP_HOOK_STATE_DIR: scratch,
      CLAUDE_PROJECT_DIR: scratch,
    };
    delete env.NODE_TEST_CONTEXT; // let the inner `node --test` run as a normal top-level run
    delete env.EDDY_STOP_HOOK_DISABLE;
    return spawnSync(process.execPath, [hookPath], {
      input: JSON.stringify({ session_id: sessionId, stop_hook_active: false }),
      encoding: "utf8",
      env,
    });
  };

  it("blocks the turn (exit 2) when a check fails, naming the command", () => {
    const result = run("failing", failingTest);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /deliberately-failing\.test\.mjs/);
  });

  it("lets the turn end when checks pass, and skips them while nothing changes", () => {
    assert.equal(run("passing", passingTest).status, 0);
    const again = run("passing", passingTest);
    assert.equal(again.status, 0);
  });

  it(`stops blocking after ${MAX_CONSECUTIVE_BLOCKS} failures and tells the user`, () => {
    for (let attempt = 1; attempt <= MAX_CONSECUTIVE_BLOCKS; attempt++) {
      assert.equal(run("stuck", failingTest).status, 2);
    }
    const released = run("stuck", failingTest);
    assert.equal(released.status, 0);
    assert.match(JSON.parse(released.stdout).systemMessage, /still failing/);
  });
});
