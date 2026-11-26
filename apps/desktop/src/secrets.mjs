// Every installed copy of Eddy makes its own secrets on first run (ADR-0036): the database
// passwords, the key pair the web signs service tokens with, the cookie secret and the two
// shared tokens. Nothing is fixed in the installer, so one copy's secrets open nothing on
// another. They are kept in the user's own app-data folder, readable by that Windows account.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {object} Secrets
 * @property {string} ownerPassword the database owner's password (migrations and the seed)
 * @property {string} runtimePassword the runtime role's password (the API and the worker)
 * @property {string} authSecret signs the open profile's cookie
 * @property {string} mathsToken shared by the API and maths-core
 * @property {string} sceneToken shared by the API and scene-check
 * @property {string} privateKeyB64 the web signs service tokens with it
 * @property {string} publicKeyB64 the API verifies them with it
 */

const FILE = "secrets.json";
const KEYS = /** @type {const} */ ([
  "ownerPassword",
  "runtimePassword",
  "authSecret",
  "mathsToken",
  "sceneToken",
  "privateKeyB64",
  "publicKeyB64",
]);

/** @returns {Secrets} */
export function createSecrets() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  // Hex, so a password can sit in a database URL without escaping.
  const random = () => randomBytes(32).toString("hex");
  return {
    ownerPassword: random(),
    runtimePassword: random(),
    authSecret: random(),
    mathsToken: random(),
    sceneToken: random(),
    privateKeyB64: Buffer.from(privateKey, "utf8").toString("base64"),
    publicKeyB64: Buffer.from(publicKey, "utf8").toString("base64"),
  };
}

/**
 * The secrets of this install: read from `dir`, or made and saved there the first time.
 * @param {string} dir
 * @returns {Secrets}
 */
export function loadOrCreateSecrets(dir) {
  const file = path.join(dir, FILE);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    const complete = KEYS.every((key) => typeof saved[key] === "string" && saved[key].length >= 32);
    // A damaged file is not patched up with new values: the database was made with the old
    // passwords, so new ones would lock Eddy out of its own data.
    if (!complete) throw new Error(`${file} is damaged. Eddy cannot open its database.`);
    return saved;
  }
  mkdirSync(dir, { recursive: true });
  const secrets = createSecrets();
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}
