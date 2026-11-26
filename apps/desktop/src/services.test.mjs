// The whole desktop app without its window: the built parts, a brand-new data folder, a private
// PostgreSQL, set-up, every service, and a student's first steps. Then it is stopped and started
// again, as when Eddy is closed and reopened. Skips when the parts have not been built
// (`pnpm --filter @eddy/desktop build`).
import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { resourcesDir } from "../scripts/paths.mjs";
import { baseEnv, startServices } from "./services.mjs";

const PARTS = [
  "web/apps/web/server.js",
  "scene-check/server.mjs",
  "python/eddy-api/eddy-api.exe",
  "python/eddy-maths/eddy-maths.exe",
  "postgres/bin/postgres.exe",
  "data/curriculum",
];
const missing = PARTS.filter((part) => !existsSync(path.join(resourcesDir, part)));

/** A service token as apps/web signs them: ES256, 60 seconds. */
function token(
  /** @type {string} */ privateKeyB64,
  /** @type {string} */ subject,
  /** @type {string} */ role,
) {
  const encode = (/** @type {object} */ value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    iss: "eddy-web",
    aud: "eddy-api",
    sub: subject,
    role,
    iat: now,
    exp: now + 60,
  })}`;
  const key = Buffer.from(privateKeyB64, "base64").toString("utf8");
  const signature = sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" });
  return `${body}.${signature.toString("base64url")}`;
}

describe(
  "the desktop app's services",
  { skip: missing.length > 0 && `not built: ${missing.join(", ")}` },
  () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "eddy-desktop-"));
    /** @type {import("./services.mjs").Running | undefined} */
    let running;
    const start = () =>
      startServices({
        resources: resourcesDir,
        dataDir,
        node: { command: process.execPath },
        environment: "development",
      });

    after(async () => {
      await running?.stop();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    });

    /** @param {string} route @param {string} bearer @param {unknown} [body] */
    async function api(route, bearer, body) {
      assert.ok(running);
      const response = await fetch(`http://127.0.0.1:${running.ports.api}${route}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: /** @type {any} */ (await response.json()) };
    }

    let profileId = "";

    it("starts from nothing: a new database, set up and seeded, and every service answering", async () => {
      running = await start();
      const picker = await (await fetch(`${running.webUrl}/profiles`)).text();
      // The web reached the API through a signed token and found no profiles yet.
      assert.match(picker, /Welcome to Eddy/);
      assert.match(picker, /There are no profiles on this computer yet/);
    });

    it("keeps its secrets to this install, and passes none of the computer's own settings on", () => {
      assert.ok(running);
      const saved = JSON.parse(readFileSync(path.join(dataDir, "secrets.json"), "utf8"));
      assert.equal(saved.ownerPassword, running.secrets.ownerPassword);
      assert.notEqual(saved.ownerPassword, saved.runtimePassword);
      const env = baseEnv({
        SystemRoot: "C:\\Windows",
        ANTHROPIC_API_KEY: "sk-nope",
        DATABASE_URL: "x",
      });
      assert.deepEqual(env, { SystemRoot: "C:\\Windows" });
    });

    it("makes a profile and takes a lesson with typed chat off", async () => {
      assert.ok(running);
      const local = token(running.secrets.privateKeyB64, "system:local", "system");
      const year = new Date().getFullYear() - 15;
      const made = await api("/v1/local/profiles", local, {
        name: "Sam",
        birth_year: year,
        birth_month: 6,
      });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      profileId = made.body.id;
      assert.match(await (await fetch(`${running.webUrl}/profiles`)).text(), /Sam/);

      // A lesson needs the database, maths-core and the curriculum seed all working together.
      const student = token(running.secrets.privateKeyB64, profileId, "student");
      const lesson = await api("/v1/tutor/sessions", student, { node: "N1" });
      assert.equal(lesson.status, 200, JSON.stringify(lesson.body));
      assert.ok(lesson.body.waiting_for.length > 0);
      assert.ok(!lesson.body.waiting_for.includes("message"), "typed chat is off");
    });

    it("stops everything, and finds the same data when it is opened again", async () => {
      assert.ok(running);
      const before = running.ports.api;
      await running.stop();
      await assert.rejects(
        fetch(`http://127.0.0.1:${before}/health`, { signal: AbortSignal.timeout(2000) }),
      );
      assert.ok(
        !existsSync(path.join(dataDir, "postgres", "postmaster.pid")),
        "PostgreSQL has stopped",
      );

      running = await start();
      const local = token(running.secrets.privateKeyB64, "system:local", "system");
      const listed = await api("/v1/local/profiles", local);
      assert.deepEqual(
        listed.body.map((/** @type {{ id: string, name: string }} */ profile) => [
          profile.id,
          profile.name,
        ]),
        [[profileId, "Sam"]],
      );
    });
  },
);
