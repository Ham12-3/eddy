// The scene-check bundle the desktop app ships: it must run with plain Node, away from the
// repository's TypeScript tooling, and answer exactly as the service does in development.
// Skips when the bundle has not been built (`pnpm --filter @eddy/desktop build:scene-check`).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { resourcesDir } from "./paths.mjs";

const bundle = path.join(resourcesDir, "scene-check", "server.mjs");
const TOKEN = "test-token-0123456789-0123456789-abc";

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

describe("the scene-check bundle", { skip: !existsSync(bundle) && "not built" }, () => {
  /** @type {import("node:child_process").ChildProcess} */
  let child;
  let base = "";

  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [bundle], {
      // A folder that is not the repository: the bundle must need nothing beside itself.
      cwd: path.dirname(bundle),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        SCENE_CHECK_SERVICE_TOKEN: TOKEN,
        SCENE_CHECK_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    for (let tries = 0; tries < 100; tries += 1) {
      if (output.includes("scene-check serving")) return;
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`The bundle did not start:\n${output}`);
  });

  after(() => {
    child?.kill();
  });

  /**
   * @param {string} route
   * @param {unknown} body
   * @param {string} [token]
   */
  async function post(route, body, token = TOKEN) {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-token": token },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: /** @type {any} */ (await response.json()) };
  }

  it("answers health checks, and nothing else without the token", async () => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const refused = await post("/v1/scenes/context", { template: "x", item: {} }, "wrong");
    assert.equal(refused.status, 401);
  });

  it("builds a Tier D scene: the registry and the layout engine are inside the bundle", async () => {
    const { status, body } = await post("/v1/scenes/context", {
      template: "number_line.compare_negatives",
      item: { a: 13, b: 6 },
      studentAnswer: -6,
    });
    assert.equal(status, 200);
    assert.equal(body.template, "number_line.compare_negatives@1");
    assert.ok(body.claims.length > 0);
  });

  it("refuses an unknown scene and a bad item, as in development", async () => {
    const unknown = { template: "nope", item: { a: 13, b: 6 }, studentAnswer: -6 };
    assert.equal((await post("/v1/scenes/context", unknown)).status, 404);
    const bad = await post("/v1/scenes/context", {
      template: "number_line.compare_negatives",
      item: { first: "x" },
      studentAnswer: -6,
    });
    assert.equal(bad.status, 422);
  });

  it("has no browser: a keyframe request fails without taking the service down", async () => {
    const drawn = await post("/v1/scenes/keyframes", {
      template: "number_line.compare_negatives",
      item: { a: 13, b: 6 },
      studentAnswer: -6,
      beats: [],
    });
    assert.ok(drawn.status >= 400, `keyframes answered ${drawn.status}`);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});
