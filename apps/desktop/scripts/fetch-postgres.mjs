// pnpm --filter @eddy/desktop build:postgres
//
// The desktop app carries its own PostgreSQL (ADR-0036): the code leans on Postgres throughout,
// so there is no lighter database to swap in. This fetches the official Windows binaries, the
// same version the tests run against (compose.yaml), checks the file is the one this script
// expects, and unpacks only what a server needs into resources/postgres.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { cacheDir, resourcesDir } from "./paths.mjs";

export const POSTGRES_VERSION = "16.15";
const FILE = `postgresql-${POSTGRES_VERSION}-2-windows-x64-binaries.zip`;
// EnterpriseDB builds the Windows binaries that postgresql.org's download page links to.
const URL_ = `https://get.enterprisedb.com/postgresql/${FILE}`;
// Fixed when this script was written, so every later build gets the very same file.
const SHA256 = "840b9d265f6ab6c0a971c1d8e9096de564950d38dc2a5ccd98c8820179ecf115";

const zip = path.join(cacheDir, FILE);
const out = path.join(resourcesDir, "postgres");

/** @param {string} file @returns {Promise<string>} */
async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

mkdirSync(cacheDir, { recursive: true });
if (!existsSync(zip)) {
  console.log(`postgres: downloading ${URL_}`);
  const response = await fetch(URL_);
  if (!response.ok || !response.body) {
    console.error(`postgres: the download answered ${response.status}`);
    process.exit(1);
  }
  const partial = `${zip}.part`;
  await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(partial));
  const { renameSync } = await import("node:fs");
  renameSync(partial, zip);
}
const digest = await sha256(zip);
if (digest !== SHA256) {
  console.error(`postgres: ${FILE} has SHA-256 ${digest}, not the expected ${SHA256}.`);
  console.error("Delete it from apps/desktop/.cache to download it again.");
  process.exit(1);
}

// A server needs its programs, their libraries and the share folder (time zones, catalogues).
// The archive also holds pgAdmin, StackBuilder, documentation and headers: none of that ships.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// Windows' own tar reads zip files; Git Bash's does not, so it is named in full.
const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const unpacked = spawnSync(
  tar,
  ["-xf", zip, "-C", out, "--strip-components=1", "pgsql/bin", "pgsql/lib", "pgsql/share"],
  { stdio: "inherit" },
);
if (unpacked.status !== 0) process.exit(unpacked.status ?? 1);

// Programs the app never runs. The server, initdb and pg_ctl stay, with every library.
const KEEP = new Set(["postgres.exe", "initdb.exe", "pg_ctl.exe", "pg_isready.exe", "psql.exe"]);
for (const entry of readdirSync(path.join(out, "bin"))) {
  if (entry.endsWith(".exe") && !KEEP.has(entry)) rmSync(path.join(out, "bin", entry));
}
for (const extra of ["share/doc", "share/man", "lib/pgxs"]) {
  rmSync(path.join(out, extra), { recursive: true, force: true });
}

/** @param {string} dir @returns {number} */
function size(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? size(full) : statSync(full).size;
  }
  return total;
}
console.log(
  `postgres: ${out} (PostgreSQL ${POSTGRES_VERSION}, ${Math.round(size(out) / 1024 / 1024)} MB)`,
);
