// The whole desktop app without its window: the built parts, a brand-new data folder, a private
// PostgreSQL, set-up, every service, and a student's first steps. Then it is stopped and started
// again, as when Eddy is closed and reopened. Skips when the parts have not been built
// (`pnpm --filter @eddy/desktop build`). Heavy: `pnpm --filter @eddy/desktop test:app`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { sign } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resourcesDir } from "../scripts/paths.mjs";
import { stopPostgres } from "./postgres.mjs";
import { baseEnv, startServices, WINDOW_COOKIE } from "./services.mjs";

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
    // A folder like a real one: a space, and a letter outside plain ASCII, as in a Windows
    // user name such as "Zoë Smith". PostgreSQL's programs read paths in the system code page.
    const dataDir = mkdtempSync(path.join(tmpdir(), "eddy desktop Zoë-"));
    /** @type {import("./services.mjs").Running | undefined} */
    let running;
    /** @type {string[]} */
    const failures = [];
    const start = () =>
      startServices({
        resources: resourcesDir,
        dataDir,
        environment: "development",
        onFailure: (name, reason) => failures.push(`${name}: ${reason}`),
      });

    after(async () => {
      await running?.stop();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    });

    /** A page as Eddy's own window asks for it: with this launch's secret. */
    async function page(/** @type {string} */ route) {
      assert.ok(running);
      const response = await fetch(`${running.webUrl}${route}`, {
        headers: { cookie: `${WINDOW_COOKIE}=${running.secrets.windowSecret}` },
      });
      return { status: response.status, text: await response.text() };
    }

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
      const picker = await page("/profiles");
      // The web reached the API through a signed token and found no profiles yet.
      assert.equal(picker.status, 200);
      assert.match(picker.text, /Welcome to Eddy/);
      assert.match(picker.text, /There are no profiles on this computer yet/);
    });

    it("serves its own window and nobody else on the computer", async () => {
      assert.ok(running);
      // Another program, or another Windows account, can reach a local port. Without this
      // launch's secret it gets nothing: no page, no profile names, no way to open one.
      for (const route of ["/profiles", "/privacy", "/settings/my-data/download", "/"]) {
        const bare = await fetch(`${running.webUrl}${route}`, { redirect: "manual" });
        assert.equal(bare.status, 403, route);
      }
      const guess = await fetch(`${running.webUrl}/profiles`, {
        headers: { cookie: `${WINDOW_COOKIE}=${"0".repeat(64)}` },
      });
      assert.equal(guess.status, 403);
      // The API and the two helpers each ask for their own secret.
      const { api: apiPort, maths, scenes } = running.ports;
      assert.equal((await fetch(`http://127.0.0.1:${apiPort}/v1/local/profiles`)).status, 401);
      assert.equal((await fetch(`http://127.0.0.1:${maths}/v1/templates`)).status, 401);
      const scene = await fetch(`http://127.0.0.1:${scenes}/v1/scenes/context`, { method: "POST" });
      assert.equal(scene.status, 401);
    });

    it("keeps only the database passwords, and passes none of the computer's settings on", () => {
      assert.ok(running);
      const saved = JSON.parse(readFileSync(path.join(dataDir, "secrets.json"), "utf8"));
      assert.deepEqual(Object.keys(saved).sort(), ["ownerPassword", "runtimePassword"]);
      assert.equal(saved.ownerPassword, running.secrets.ownerPassword);
      assert.notEqual(saved.ownerPassword, saved.runtimePassword);
      // The password file initdb reads is gone, and nothing else was written beside the data.
      assert.deepEqual(readdirSync(dataDir).sort(), ["logs", "postgres", "secrets.json"]);
      const env = baseEnv({
        SystemRoot: "C:\\Windows",
        ANTHROPIC_API_KEY: "sk-nope",
        DATABASE_URL: "x",
        NODE_OPTIONS: "--inspect",
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
      assert.match((await page("/profiles")).text, /Sam/);

      // A lesson needs the database, maths-core and the curriculum seed all working together.
      const student = token(running.secrets.privateKeyB64, profileId, "student");
      const lesson = await api("/v1/tutor/sessions", student, { node: "N1" });
      assert.equal(lesson.status, 200, JSON.stringify(lesson.body));
      assert.ok(lesson.body.waiting_for.length > 0);
      assert.ok(!lesson.body.waiting_for.includes("message"), "typed chat is off");
    });

    it("runs the privacy jobs: the worker is alive and has done its first round", () => {
      // The 90-day purge and the erasure of deleted profiles happen only in the worker.
      const log = readFileSync(path.join(dataDir, "logs", "worker.log"), "utf8");
      assert.match(log, /purge:/);
      assert.match(log, /erasures:/);
      assert.deepEqual(failures, []);
    });

    it("stops everything, and finds the same data when it is opened again", async () => {
      assert.ok(running);
      const before = running.ports;
      const firstLaunch = running.secrets;
      await running.stop();
      // Every one of them is gone, not just the API.
      for (const port of [before.api, before.maths, before.scenes, before.web]) {
        await assert.rejects(
          fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }),
          `something still answers on port ${port}`,
        );
      }
      assert.ok(
        !existsSync(path.join(dataDir, "postgres", "postmaster.pid")),
        "PostgreSQL has stopped",
      );

      running = await start();
      // The same database passwords, and everything else made afresh for this launch.
      assert.equal(running.secrets.ownerPassword, firstLaunch.ownerPassword);
      assert.notEqual(running.secrets.windowSecret, firstLaunch.windowSecret);
      assert.notEqual(running.secrets.authSecret, firstLaunch.authSecret);
      assert.notEqual(running.secrets.privateKeyB64, firstLaunch.privateKeyB64);
      const local = token(running.secrets.privateKeyB64, "system:local", "system");
      const listed = await api("/v1/local/profiles", local);
      assert.deepEqual(
        listed.body.map((/** @type {{ id: string, name: string }} */ profile) => [
          profile.id,
          profile.name,
        ]),
        [[profileId, "Sam"]],
      );
      // A token signed with the last launch's key opens nothing now.
      const stale = token(firstLaunch.privateKeyB64, "system:local", "system");
      assert.equal((await api("/v1/local/profiles", stale)).status, 401);
      assert.deepEqual(failures, [], "no service stopped by itself");
    });

    it("leaves nothing running when the shell is ended, not closed", async () => {
      // Task Manager's "End task", a crash, a power cut: no clean-up code runs. Everything the
      // shell started must notice it has gone and stop, the database included.
      const dir = mkdtempSync(path.join(tmpdir(), "eddy desktop ended-"));
      const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-services.mjs");
      const shell = spawn(process.execPath, [script, dir], { stdio: ["ignore", "pipe", "pipe"] });
      try {
        /** @type {{ ports: Record<string, number> }} */
        const started = await new Promise((resolve, reject) => {
          let output = "";
          let errors = "";
          shell.stdout.on("data", (chunk) => {
            output += chunk;
            const line = output.split("\n").find((candidate) => candidate.startsWith("{"));
            if (line) resolve(JSON.parse(line));
          });
          shell.stderr.on("data", (chunk) => (errors += chunk));
          shell.on("exit", (code) => reject(new Error(`the shell exited (${code}): ${errors}`)));
        });
        const pid = path.join(dir, "postgres", "postmaster.pid");
        assert.ok(existsSync(pid), "the database is running");

        shell.kill(); // On Windows this ends the process at once.

        const { api: apiPort, maths, scenes, web } = started.ports;
        const stillUp = async () => {
          const answering = [];
          for (const [name, port] of Object.entries({ api: apiPort, maths, scenes, web })) {
            try {
              await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
              answering.push(name);
            } catch {
              // Gone, as it should be.
            }
          }
          if (existsSync(pid)) answering.push("the database");
          return answering;
        };
        let left = await stillUp();
        for (let tries = 0; left.length > 0 && tries < 60; tries += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          left = await stillUp();
        }
        assert.deepEqual(left, [], "still running after the shell was ended");
      } finally {
        shell.kill();
        // If the test failed, the database may still be running: stop it, so that the failure
        // shown is the test's own and the folder can be removed.
        await stopPostgres({
          binDir: path.join(resourcesDir, "postgres", "bin"),
          dataDir: path.join(dir, "postgres"),
          env: baseEnv(),
        });
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
        } catch {
          // A file still held open: the folder is in the temp folder and can stay.
        }
      }
    });
  },
);
