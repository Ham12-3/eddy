#!/usr/bin/env node
// House style: never use en dashes or em dashes, in code, comments, copy or docs.
// Scans every tracked or new (not ignored) text file, whatever its extension, and fails with
// file:line for each hit. Binary files are detected and skipped.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SKIP = new Set([
  "docs/brief.md", // the original brief, kept verbatim
  "pnpm-lock.yaml",
  "uv.lock",
]);
// Built from code points so this file never contains the characters it hunts for.
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => file && !SKIP.has(file));

let scanned = 0;
const hits = [];
for (const file of files) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    continue; // deleted in the working tree
  }
  if (bytes.subarray(0, 8000).includes(0)) continue; // binary
  scanned++;
  bytes
    .toString("utf8")
    .split("\n")
    .forEach((line, index) => {
      if (DASHES.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
    });
}

if (hits.length > 0) {
  console.error("En or em dashes found. Use commas, full stops, colons or brackets instead:");
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`No en or em dashes in ${scanned} text files.`);
