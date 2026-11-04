#!/usr/bin/env node
// Creates local development secrets and writes them to the git-ignored .env files:
//   apps/web/.env.local        service-token private key (web signs, ADR-0008)
//   services/api/.env          service-token public key, maths-core token, local database URL
//   services/maths-core/.env   maths-core token
// Prints file names only, never values. Refuses to overwrite unless run with --force.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const mathsCoreToken = randomBytes(32).toString("base64url");

const files = {
  "apps/web/.env.local": {
    API_BASE_URL: "http://127.0.0.1:8300",
    SERVICE_TOKEN_PRIVATE_KEY_B64: b64(privateKey),
  },
  "services/api/.env": {
    SERVICE_TOKEN_PUBLIC_KEY_B64: b64(publicKey),
    DATABASE_URL: "postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy",
    MATHS_CORE_BASE_URL: "http://127.0.0.1:8310",
    MATHS_CORE_SERVICE_TOKEN: mathsCoreToken,
  },
  "services/maths-core/.env": {
    MATHS_CORE_SERVICE_TOKEN: mathsCoreToken,
  },
};

const existing = Object.keys(files).filter((path) => existsSync(join(root, path)));
if (existing.length > 0 && !force) {
  console.error(`Not overwriting existing files: ${existing.join(", ")}`);
  console.error("Run `pnpm keys:dev --force` to replace all of them with a fresh set.");
  process.exit(1);
}

for (const [path, values] of Object.entries(files)) {
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  // Owner-only permissions where the OS supports them; "wx" never overwrites without --force.
  writeFileSync(
    join(root, path),
    `# Written by scripts/dev-keys.mjs. Local development only.\n${body}\n`,
    { mode: 0o600, flag: force ? "w" : "wx" },
  );
  console.log(`Wrote ${path}`);
}
