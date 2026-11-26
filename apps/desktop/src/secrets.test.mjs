// The desktop app's secrets: which are kept, which are made afresh, and what happens to a file
// that cannot be read.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createLaunchSecrets, loadOrCreatePasswords, SECRETS_FILE } from "./secrets.mjs";

/** @param {(dir: string) => Promise<void>} body */
async function inTempDir(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "eddy-secrets-"));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Stands in for Windows' own protection: reversible, and plainly not the text itself. */
const codec = {
  seal: async (/** @type {string} */ text) => Buffer.from(text).reverse().toString("base64"),
  open: async (/** @type {string} */ sealed) => Buffer.from(sealed, "base64").reverse().toString(),
};

describe("the database passwords", () => {
  it("are made once and are the same at every later start", async () => {
    await inTempDir(async (dir) => {
      const first = await loadOrCreatePasswords(dir);
      assert.match(first.ownerPassword, /^[0-9a-f]{64}$/);
      assert.notEqual(first.ownerPassword, first.runtimePassword);
      assert.deepEqual(await loadOrCreatePasswords(dir), first);
      // Nothing half-written is left beside the file.
      assert.deepEqual(readdirSync(dir), [SECRETS_FILE]);
    });
  });

  it("are sealed on disk when the shell can seal them", async () => {
    await inTempDir(async (dir) => {
      const made = await loadOrCreatePasswords(dir, codec);
      const onDisk = readFileSync(path.join(dir, SECRETS_FILE), "utf8");
      assert.ok(!onDisk.includes(made.ownerPassword));
      assert.ok(!onDisk.includes(made.runtimePassword));
      assert.deepEqual(await loadOrCreatePasswords(dir, codec), made);
      // Without the key (another account, another computer) the file opens nothing.
      await assert.rejects(loadOrCreatePasswords(dir), /is damaged/);
    });
  });

  it("are never replaced when the file cannot be read, and the error quotes nothing from it", async () => {
    for (const broken of [
      '{"ownerPassword": "sup3r-s3cret-va',
      "",
      "[]",
      '{"ownerPassword":"short"}',
    ]) {
      await inTempDir(async (dir) => {
        const file = path.join(dir, SECRETS_FILE);
        writeFileSync(file, broken);
        await assert.rejects(loadOrCreatePasswords(dir), (/** @type {Error} */ error) => {
          assert.match(error.message, /is damaged/);
          assert.match(error.message, /delete the folder/);
          assert.ok(!error.message.includes("sup3r"), "the message quotes the file");
          return true;
        });
        // New passwords would not open the database that was made with the old ones.
        assert.equal(readFileSync(file, "utf8"), broken);
      });
    }
  });
});

describe("the secrets of one launch", () => {
  it("are all different, and different again at the next launch", () => {
    const first = createLaunchSecrets();
    const second = createLaunchSecrets();
    const values = Object.values(first);
    assert.equal(new Set(values).size, values.length);
    for (const key of /** @type {const} */ ([
      "authSecret",
      "windowSecret",
      "mathsToken",
      "sceneToken",
    ])) {
      assert.match(first[key], /^[0-9a-f]{64}$/);
      assert.notEqual(first[key], second[key]);
    }
    assert.notEqual(first.privateKeyB64, second.privateKeyB64);
    const pem = Buffer.from(first.privateKeyB64, "base64").toString("utf8");
    assert.match(pem, /BEGIN PRIVATE KEY/);
  });
});
