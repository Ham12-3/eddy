#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell. Exit code 2 denies the call; stderr tells Claude why.
// The rules live in lib/guard.mjs. If the guard itself fails, it denies (fails closed).
import { evaluate, readDotEnvDatabaseUrl } from "./lib/guard.mjs";

function deny(reason) {
  process.stderr.write(
    `Blocked by .claude/hooks/guard-bash.mjs: ${reason}\n` +
      "If this is genuinely needed, ask the user to run it themselves or to approve it explicitly.\n",
  );
  process.exit(2);
}

try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw || "{}");
  if (["Bash", "PowerShell"].includes(input.tool_name)) {
    const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    const reason = evaluate(String(input.tool_input?.command ?? ""), {
      env: process.env,
      readDatabaseUrl: () => readDotEnvDatabaseUrl(root),
    });
    if (reason) deny(reason);
  }
} catch (error) {
  deny(
    `the guard could not check this command (${error instanceof Error ? error.message : error}).`,
  );
}
