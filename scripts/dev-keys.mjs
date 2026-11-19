#!/usr/bin/env node
// Creates local development secrets and writes them to the git-ignored .env files:
//   apps/web/.env.local          service-token private key (web signs, ADR-0008), the Auth.js
//                                secret, AUTH_URL and the Mailpit SMTP server
//   services/api/.env            service-token public key, service tokens, local database URL,
//                                EDDY_ENVIRONMENT=development
//   services/maths-core/.env     maths-core token
//   workers/scene-check/.env     scene-check token (ADR-0030)
// Prints file and key names only, never values.
//
// An existing file keeps every line it has, comments included: missing keys are added at the end,
// and a value is replaced only when it is a placeholder, too short to be a token, or one half of a
// shared token that no longer matches the other. A key you added yourself (ANTHROPIC_API_KEY) is
// never touched. `--force` makes a fresh set of the keys this script manages and keeps the rest.
import { createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;
const PLACEHOLDERS = new Set(["shared-random-token", "base64-of-the-matching-SPKI-PEM-public-key"]);
const MIN_TOKEN_LENGTH = 32;

function read(path) {
  const full = join(root, path);
  const lines = existsSync(full) ? readFileSync(full, "utf8").split(/\r?\n/) : [];
  if (lines.at(-1) === "") lines.pop();
  const values = new Map();
  for (const line of lines) {
    const match = LINE.exec(line);
    // The first occurrence of a key is the one this script reads and rewrites.
    if (match && !values.has(match[1])) values.set(match[1], match[2].trim());
  }
  return { lines, values };
}

const current = {
  web: read("apps/web/.env.local"),
  api: read("services/api/.env"),
  mathsCore: read("services/maths-core/.env"),
  sceneCheck: read("workers/scene-check/.env"),
};
const usable = (value) =>
  Boolean(value) && !PLACEHOLDERS.has(value) && value.length >= MIN_TOKEN_LENGTH;
const keep = (...values) => (force ? undefined : values.find(usable));
const token = () => randomBytes(32).toString("base64url");

// Shared tokens: reuse whichever side already has a usable one, so the pair keeps matching.
const mathsCoreToken =
  keep(
    current.api.values.get("MATHS_CORE_SERVICE_TOKEN"),
    current.mathsCore.values.get("MATHS_CORE_SERVICE_TOKEN"),
  ) ?? token();
const sceneCheckToken =
  keep(
    current.api.values.get("SCENE_CHECK_SERVICE_TOKEN"),
    current.sceneCheck.values.get("SCENE_CHECK_SERVICE_TOKEN"),
  ) ?? token();

// The signing pair only matters together: make a new one unless both halves exist.
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
let privateB64 = keep(current.web.values.get("SERVICE_TOKEN_PRIVATE_KEY_B64"));
let publicB64 = keep(current.api.values.get("SERVICE_TOKEN_PUBLIC_KEY_B64"));
const fromB64 = (text) => Buffer.from(text, "base64").toString("utf8").trim();
function matches(privateKeyB64, publicKeyB64) {
  try {
    const derived = createPublicKey(fromB64(privateKeyB64)).export({ type: "spki", format: "pem" });
    return String(derived).trim() === fromB64(publicKeyB64);
  } catch {
    return false;
  }
}
// A pair whose halves do not match signs tokens the API rejects: make a new one.
const freshPair = !privateB64 || !publicB64 || !matches(privateB64, publicB64);
if (freshPair) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  [privateB64, publicB64] = [b64(privateKey), b64(publicKey)];
}

// For each file: the keys it needs, and which must equal the value given (secrets that pair up).
// Auth.js signs and encrypts its cookies with this; the join steps sign theirs too (ADR-0032).
const authSecret = keep(current.web.values.get("AUTH_SECRET")) ?? token();
const files = {
  "apps/web/.env.local": [
    current.web,
    {
      API_BASE_URL: "http://127.0.0.1:8300",
      SERVICE_TOKEN_PRIVATE_KEY_B64: privateB64,
      AUTH_SECRET: authSecret,
      // Where sign-in links point; it must match the address you open the app at.
      AUTH_URL: "http://localhost:3300",
      // Mailpit (compose.yaml): read sign-in emails at http://127.0.0.1:8025.
      EMAIL_SERVER: "smtp://127.0.0.1:1025",
      EMAIL_FROM: "Eddy <sign-in@eddy.localhost>",
    },
    ["SERVICE_TOKEN_PRIVATE_KEY_B64", "AUTH_SECRET"],
  ],
  "services/api/.env": [
    current.api,
    {
      SERVICE_TOKEN_PUBLIC_KEY_B64: publicB64,
      DATABASE_URL: "postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy",
      // The runtime role the API and worker connect as (ADR-0024, migration 0006).
      RUNTIME_DATABASE_URL: "postgresql+psycopg://eddy_app:eddy_app@127.0.0.1:5442/eddy",
      MATHS_CORE_BASE_URL: "http://127.0.0.1:8310",
      MATHS_CORE_SERVICE_TOKEN: mathsCoreToken,
      SCENE_CHECK_BASE_URL: "http://127.0.0.1:8320",
      SCENE_CHECK_SERVICE_TOKEN: sceneCheckToken,
      // Local development: the ZDR gate's local-database exception and the unapproved
      // safeguarding draft are allowed here only (ADR-0031).
      EDDY_ENVIRONMENT: "development",
    },
    ["SERVICE_TOKEN_PUBLIC_KEY_B64", "MATHS_CORE_SERVICE_TOKEN", "SCENE_CHECK_SERVICE_TOKEN"],
  ],
  "services/maths-core/.env": [
    current.mathsCore,
    { MATHS_CORE_SERVICE_TOKEN: mathsCoreToken },
    ["MATHS_CORE_SERVICE_TOKEN"],
  ],
  "workers/scene-check/.env": [
    current.sceneCheck,
    { SCENE_CHECK_SERVICE_TOKEN: sceneCheckToken },
    ["SCENE_CHECK_SERVICE_TOKEN"],
  ],
};

for (const [path, [{ lines, values }, wanted, paired]] of Object.entries(files)) {
  const output = lines.length
    ? [...lines]
    : ["# Written by scripts/dev-keys.mjs. Local development only."];
  const changed = [];
  for (const [key, value] of Object.entries(wanted)) {
    const existing = values.get(key);
    const replace =
      existing === undefined || existing === "" || (paired.includes(key) && existing !== value);
    if (!replace) continue;
    changed.push(key);
    const at = output.findIndex((line) => LINE.exec(line)?.[1] === key);
    if (at >= 0) output[at] = `${key}=${value}`;
    else output.push(`${key}=${value}`);
  }
  if (changed.length === 0) {
    console.log(`${path}: up to date`);
    continue;
  }
  const full = join(root, path);
  // Owner-only permissions where the OS supports them, for new and existing files alike.
  writeFileSync(full, `${output.join("\n")}\n`, { mode: 0o600 });
  chmodSync(full, 0o600);
  console.log(`${path}: wrote ${changed.join(", ")}`);
}
