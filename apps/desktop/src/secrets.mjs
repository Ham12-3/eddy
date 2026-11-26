// The desktop app's secrets (ADR-0036). Nothing is fixed in the installer, so one copy's secrets
// open nothing on another.
//
// - Kept for the life of the install: the two database passwords. The database was made with
//   them, so they must be the same at every start. They live in the user's own app-data folder,
//   sealed with the Windows account's key where the shell can do that (`codec`).
// - Made afresh at every launch and never written down: the key pair the web signs service
//   tokens with, the cookie secret, the window secret and the two shared tokens. Closing Eddy
//   throws them away, so an open profile's cookie cannot outlive the window.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {object} DatabasePasswords
 * @property {string} ownerPassword the database owner's password (migrations and the seed)
 * @property {string} runtimePassword the runtime role's password (the API and the worker)
 */

/**
 * @typedef {object} LaunchSecrets
 * @property {string} authSecret signs the open profile's cookie
 * @property {string} windowSecret proves a request comes from Eddy's own window
 * @property {string} mathsToken shared by the API and maths-core
 * @property {string} sceneToken shared by the API and scene-check
 * @property {string} privateKeyB64 the web signs service tokens with it
 * @property {string} publicKeyB64 the API verifies them with it
 */

/** @typedef {DatabasePasswords & LaunchSecrets} Secrets */

/**
 * How the saved passwords are sealed on disk. The shell passes Windows' own protection
 * (Electron's safeStorage); without one they are stored as they are.
 * @typedef {{ seal: (text: string) => string | Promise<string>, open: (sealed: string) => string | Promise<string> }} Codec
 */

export const SECRETS_FILE = "secrets.json";

// Hex, so a password can sit in a database URL without escaping.
const random = () => randomBytes(32).toString("hex");

/** @returns {LaunchSecrets} */
export function createLaunchSecrets() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    authSecret: random(),
    windowSecret: random(),
    mathsToken: random(),
    sceneToken: random(),
    privateKeyB64: Buffer.from(privateKey, "utf8").toString("base64"),
    publicKeyB64: Buffer.from(publicKey, "utf8").toString("base64"),
  };
}

/** The message for every kind of unreadable file: it never quotes what the file holds. */
function damaged(/** @type {string} */ file) {
  return new Error(
    `${file} is damaged, so Eddy cannot open its database. To start again with nothing saved, delete the folder ${path.dirname(file)}.`,
  );
}

/**
 * The database passwords of this install: read from `dir`, or made and saved there the first
 * time. A damaged file is never patched up with new values: they would not open the database.
 * @param {string} dir
 * @param {Codec} [codec]
 * @returns {Promise<DatabasePasswords>}
 */
export async function loadOrCreatePasswords(dir, codec) {
  const file = path.join(dir, SECRETS_FILE);
  if (existsSync(file)) {
    let saved;
    try {
      const stored = JSON.parse(readFileSync(file, "utf8"));
      saved = stored.sealed ? JSON.parse(await (codec ?? plain()).open(stored.sealed)) : stored;
    } catch {
      throw damaged(file);
    }
    const complete = ["ownerPassword", "runtimePassword"].every(
      (key) => typeof saved?.[key] === "string" && saved[key].length >= 32,
    );
    if (!complete) throw damaged(file);
    return { ownerPassword: saved.ownerPassword, runtimePassword: saved.runtimePassword };
  }
  mkdirSync(dir, { recursive: true });
  const passwords = { ownerPassword: random(), runtimePassword: random() };
  const body = codec ? { sealed: await codec.seal(JSON.stringify(passwords)) } : passwords;
  // Written beside the file and moved into place, so a crash never leaves half a file behind.
  const partial = `${file}.new`;
  writeFileSync(partial, JSON.stringify(body, null, 2), { mode: 0o600 });
  renameSync(partial, file);
  return passwords;
}

/** @returns {Codec} a codec for a file that was written with no sealing */
function plain() {
  return {
    seal: (text) => text,
    open: () => {
      throw new Error("sealed");
    },
  };
}
