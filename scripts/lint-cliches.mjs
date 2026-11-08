#!/usr/bin/env node
// Fails on the design clichés SPEC.md section 11 bans. Rules live in scripts/lib/cliches.mjs.
// Scans every tracked or new (not ignored) file under apps/, packages/ and workers/.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findCliches } from "./lib/cliches.mjs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => /^(apps|packages|workers)\//.test(file) && !file.includes("/node_modules/"));

const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  for (const finding of findCliches(file, text)) findings.push({ file, ...finding });
}

if (findings.length > 0) {
  console.error("Design clichés found (SPEC.md section 11):");
  for (const { file, line, rule, message, text } of findings) {
    console.error(`  ${file}:${line} [${rule}] ${message}\n      ${text}`);
  }
  console.error(
    "If one is genuinely needed, end the line with: cliche-lint-allow: <rule> (<reason>)",
  );
  process.exit(1);
}
console.log(`No design clichés in ${files.length} files.`);
