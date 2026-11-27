// The set-up program: what kind of build it is, and what the packed program will and will not do.
// The first tests need no build. The rest read `release/win-unpacked` and skip when it has not
// been made (`pnpm --filter @eddy/desktop dist`).
import assert from "node:assert/strict";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { configFor } from "../electron-builder.config.mjs";
import { desktopDir } from "./paths.mjs";

const release = path.join(desktopDir, "release");
const unpacked = path.join(release, "win-unpacked");
const program = path.join(unpacked, "Eddy.exe");
const archive = path.join(unpacked, "resources", "app.asar");

describe("the kind of build", () => {
  it("is for students unless a preview is asked for, and a preview says so in its name", () => {
    const students = configFor({ preview: false });
    assert.equal(students.extraMetadata?.eddy.preview, false);
    assert.equal(students.nsis?.artifactName, "Eddy-Setup-${version}.${ext}");
    const preview = configFor({ preview: true });
    assert.equal(preview.extraMetadata?.eddy.preview, true);
    assert.equal(preview.nsis?.artifactName, "Eddy-Preview-Setup-${version}.${ext}");
  });

  it("never looks for a newer copy of itself, and asks for no administrator password", () => {
    const config = configFor({ preview: false });
    assert.equal(config.publish, null);
    assert.equal(config.nsis?.perMachine, false);
    assert.equal(config.nsis?.packElevateHelper, false);
  });
});

/**
 * Reads the packed archive's list of files and one file from it. The format is a small header
 * (two sizes, then the list as JSON) followed by the files end to end.
 * @returns {{ names: string[], read: (name: string) => string }}
 */
function openArchive() {
  const file = openSync(archive, "r");
  try {
    const sizes = Buffer.alloc(16);
    readSync(file, sizes, 0, 16, 0);
    const headerSize = sizes.readUInt32LE(4);
    const jsonLength = sizes.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    readSync(file, json, 0, jsonLength, 16);
    const header = JSON.parse(json.toString("utf8"));
    /** @type {Map<string, { size: number, offset: string }>} */
    const entries = new Map();
    const walk = (/** @type {any} */ node, /** @type {string} */ prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        if (/** @type {any} */ (entry).files) walk(entry, `${prefix}${name}/`);
        else entries.set(`${prefix}${name}`, /** @type {any} */ (entry));
      }
    };
    walk(header, "");
    return {
      names: [...entries.keys()].sort(),
      read: (name) => {
        const entry = entries.get(name);
        assert.ok(entry, `${name} is in the archive`);
        const content = Buffer.alloc(entry.size);
        const opened = openSync(archive, "r");
        try {
          readSync(opened, content, 0, entry.size, 8 + headerSize + Number(entry.offset));
        } finally {
          closeSync(opened);
        }
        return content.toString("utf8");
      },
    };
  } finally {
    closeSync(file);
  }
}

describe("the packed program", { skip: !existsSync(program) && "not built" }, () => {
  it("is locked to being Eddy: the switches Electron reads from the program itself", () => {
    // Electron keeps its fuses after this marker: a version, a count, then one character each
    // ("0" off, "1" on, "r" removed), in the order Electron defines them.
    const marker = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
    const bytes = readFileSync(program);
    const at = bytes.indexOf(marker);
    assert.ok(at > 0, "the program has Electron's fuse marker");
    const start = at + marker.length;
    assert.equal(bytes[start], 1, "fuse format version");
    const count = bytes[start + 1] ?? 0;
    const wire = bytes.subarray(start + 2, start + 2 + count).toString("latin1");
    const fuses = {
      runAsNode: wire[0],
      cookieEncryption: wire[1],
      nodeOptions: wire[2],
      inspectArguments: wire[3],
      archiveIntegrity: wire[4],
      onlyLoadAppFromArchive: wire[5],
      browserSnapshot: wire[6],
      fileProtocolPrivileges: wire[7],
    };
    assert.deepEqual(fuses, {
      runAsNode: "0",
      cookieEncryption: "1",
      nodeOptions: "0",
      inspectArguments: "0",
      archiveIntegrity: "1",
      onlyLoadAppFromArchive: "1",
      browserSnapshot: "0",
      // Left on: see electron-builder.config.mjs.
      fileProtocolPrivileges: "1",
    });
  });

  it("carries the shell and nothing else: no tests, no test helpers", () => {
    assert.deepEqual(openArchive().names, [
      "package.json",
      "src/main.mjs",
      "src/postgres.mjs",
      "src/secrets.mjs",
      "src/services.mjs",
      "src/starting.html",
      "src/tokens.css",
      "src/window-policy.mjs",
    ]);
  });

  it("is the kind of build its set-up program says it is", () => {
    const manifest = JSON.parse(openArchive().read("package.json"));
    assert.equal(manifest.name, "eddy");
    assert.equal(typeof manifest.eddy?.preview, "boolean");
    const name = manifest.eddy.preview ? "Eddy-Preview-Setup" : "Eddy-Setup";
    assert.ok(
      existsSync(path.join(release, `${name}-${manifest.version}.exe`)),
      `${name}-${manifest.version}.exe was made with this program`,
    );
  });

  it("ships no helper for asking for an administrator password", () => {
    assert.equal(existsSync(path.join(unpacked, "resources", "elevate.exe")), false);
  });
});
