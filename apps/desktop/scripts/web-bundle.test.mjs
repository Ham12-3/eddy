// The web server the desktop app ships: it must start with plain Node from its own folder, with
// its packages laid out as ordinary folders, and behave as the desktop app (local mode).
// Skips when it has not been built (`pnpm --filter @eddy/desktop build:web`).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { resourcesDir } from "./paths.mjs";

const root = path.join(resourcesDir, "web");
const app = path.join(root, "apps/web");

/** @returns {Promise<number>} a port nothing is listening on */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** @param {string} dir @returns {string[]} every link under `dir` */
function links(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = lstatSync(full);
    if (stats.isSymbolicLink()) found.push(full);
    else if (stats.isDirectory()) found.push(...links(full));
  }
  return found;
}

describe("the web server bundle", { skip: !existsSync(app) && "not built" }, () => {
  /** @type {import("node:child_process").ChildProcess} */
  let child;
  let base = "";
  let port = 0;

  before(async () => {
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js"], {
      cwd: app,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        EDDY_LOCAL_MODE: "1",
        // Random-looking and long enough; nothing here is a real secret.
        AUTH_SECRET: "bundle-test-secret-bundle-test-secret-0123",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    for (let tries = 0; tries < 200; tries += 1) {
      if (output.includes("Ready")) return;
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`The web server did not start:\n${output}`);
  });

  after(() => {
    child?.kill();
  });

  it("carries no links: an installer can pack it as plain files", () => {
    assert.deepEqual(links(root), []);
  });

  it("carries no settings file of the developer's", () => {
    /** @param {string} dir @returns {string[]} */
    const envFiles = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return envFiles(full);
        return entry.name.startsWith(".env") ? [full] : [];
      });
    assert.deepEqual(envFiles(root), []);
  });

  it("serves the desktop privacy notice and its styles", async () => {
    const page = await fetch(`${base}/privacy`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /There is nowhere to type a message/);
    const stylesheet = /\/_next\/static\/[^"]+\.css/.exec(html)?.[0];
    assert.ok(stylesheet, "the page links a stylesheet");
    assert.equal((await fetch(`${base}${stylesheet}`)).status, 200);
  });

  it("is in local mode: sign-in is off and the picker is the way in", async () => {
    const signIn = await fetch(`${base}/sign-in`, { redirect: "manual" });
    assert.equal(signIn.status, 307);
    // To the start of this very server: the window refuses any other origin.
    assert.equal(new URL(signIn.headers.get("location") ?? "", base).href, `${base}/`);
    assert.equal((await fetch(`${base}/api/auth/session`)).status, 404);
    // No API is running here, so the picker says it is still starting, and does not crash.
    const picker = await fetch(`${base}/profiles`);
    assert.equal(picker.status, 200);
    assert.match(await picker.text(), /Eddy is still starting/);
  });

  it("answers only requests addressed to this computer", async () => {
    // fetch() will not send a different Host, so this one request is made by hand.
    const { request } = await import("node:http");
    const status = await new Promise((resolve, reject) => {
      const call = request(
        { host: "127.0.0.1", port, path: "/profiles", headers: { host: "attacker.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      call.on("error", reject);
      call.end();
    });
    assert.equal(status, 400);
  });
});
