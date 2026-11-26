// Starts and stops everything the desktop app runs (ADR-0036), all on 127.0.0.1 with ports chosen
// at each start:
//
//   PostgreSQL -> eddy-api setup -> maths-core, scene-check -> the API and its worker -> the web
//
// The Electron shell calls this; so does the test that runs the built parts without a window.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clusterIsReady,
  databaseUrl,
  initCluster,
  OWNER,
  startPostgres,
  stopPostgres,
} from "./postgres.mjs";
import { createLaunchSecrets, loadOrCreatePasswords, SECRETS_FILE } from "./secrets.mjs";

const HOST = "127.0.0.1";
const RUNTIME_ROLE = "eddy_app";
const DATABASE = "eddy";
/** The cookie the web server asks every request for (apps/web/src/lib/window-secret.ts). */
export const WINDOW_COOKIE = "eddy_window";
/** How long a child that lost its port to another program takes to give up and exit. */
const SETTLE_MS = 1500;
/** Set-up is a few seconds; a first run on a slow disk is longer. Past this it has hung. */
const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
/** `eddy-api setup` exits with this when the data belongs to a newer Eddy (eddy_api/desktop.py). */
const NEWER_DATABASE = 3;

/**
 * A running JavaScript service: what `child_process` and Electron's `utilityProcess` both give.
 * @typedef {object} NodeChild
 * @property {import("node:stream").Readable | null} stdout
 * @property {import("node:stream").Readable | null} stderr
 * @property {() => boolean} kill
 * @property {(event: "exit", listener: (code: number | null) => void) => unknown} on
 */

/**
 * Runs a script with this very Node. The script is started through `node-child.mjs`, which ends
 * it when this process goes, so nothing is left behind if the parent is killed.
 * @param {string} script
 * @param {{ env: NodeJS.ProcessEnv, cwd?: string }} options
 * @returns {NodeChild}
 */
export function runWithNode(script, { env, cwd }) {
  const launcher = path.join(path.dirname(fileURLToPath(import.meta.url)), "node-child.mjs");
  return spawn(process.execPath, [launcher, script], {
    cwd,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Eddy was closed while it was starting: not a failure, and nothing to tell anyone. */
export class StoppedError extends Error {
  constructor() {
    super("Eddy was closed while it was starting.");
    this.name = "StoppedError";
  }
}

/** @returns {Promise<number>} a port nothing is listening on */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The few things of the user's environment a child needs. Nothing else is passed down, so a
 * stray key or setting on the computer (an API key, a database URL) never reaches Eddy.
 * @param {NodeJS.ProcessEnv} source
 * @returns {NodeJS.ProcessEnv}
 */
export function baseEnv(source = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const key of [
    "SystemRoot",
    "windir",
    "PATH",
    "Path",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ]) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

/**
 * Waits for a service to answer its health check.
 * @param {string} url
 * @param {string} name
 * @param {() => void} check throws when the service has died or Eddy is being closed
 * @param {Record<string, string>} [headers]
 */
async function waitFor(url, name, check, headers = {}, seconds = 90) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    check();
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} did not answer at ${url} within ${seconds} seconds`);
}

/**
 * @typedef {object} Running
 * @property {string} webUrl where the window loads Eddy
 * @property {{ api: number, maths: number, scenes: number, web: number, postgres: number }} ports
 * @property {import("./secrets.mjs").Secrets} secrets
 * @property {() => Promise<void>} stop stops every service; safe to call twice
 */

/**
 * @param {object} options
 * @param {string} options.resources the built parts (web, scene-check, python, data, postgres)
 * @param {string} options.dataDir this install's data: the database, its passwords and logs
 * @param {typeof runWithNode} [options.runNode] what runs the two JavaScript services: this
 *   Node by default, and Electron's own helper processes in the shell
 * @param {"development" | "production"} options.environment `development` for a preview build:
 *   the tutor stays locked in production until the safeguarding script is approved
 * @param {import("./secrets.mjs").Codec} [options.codec] seals the saved database passwords
 * @param {(line: string) => void} [options.log]
 * @param {(stop: () => Promise<void>) => void} [options.onStoppable] given the way to stop
 *   everything as soon as there is anything to stop, so Eddy can be closed while it starts
 * @param {(name: string, reason: string) => void} [options.onFailure] a service stopped by
 *   itself after start-up: Eddy cannot carry on without it
 * @returns {Promise<Running>}
 */
export async function startServices({
  resources,
  dataDir,
  runNode = runWithNode,
  environment,
  codec,
  log = () => {},
  onStoppable = () => {},
  onFailure = () => {},
}) {
  const env = baseEnv();
  const logs = path.join(dataDir, "logs");
  const binDir = path.join(resources, "postgres", "bin");
  const cluster = path.join(dataDir, "postgres");

  /** @type {{ name: string, child: NodeChild }[]} */
  const children = [];
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let settingUp;
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let watcher;
  /** @type {Map<string, string>} */
  const died = new Map();
  let started = false;
  let stopped = false;

  async function stop() {
    if (stopped) return;
    stopped = true;
    settingUp?.kill();
    // The web first, the database last: nothing is left talking to something already gone.
    for (const { child } of [...children].reverse()) child.kill();
    await stopPostgres({ binDir, dataDir: cluster, env });
    // The database is stopped, so its watcher has nothing left to do.
    watcher?.kill();
  }
  onStoppable(stop);

  /** Between every step: Eddy may have been closed while the last one ran. */
  const halt = () => {
    if (stopped) throw new StoppedError();
  };
  /** @param {string} name */
  const alive = (name) => () => {
    halt();
    const reason = died.get(name);
    if (reason) throw new Error(`${name} stopped while starting: ${reason}`);
  };
  /** @param {string} name */
  const logFile = (name) => path.join(logs, `${name}.log`);

  /**
   * Keeps a service's output, and notices if it stops by itself.
   * @param {string} name
   * @param {NodeChild} child
   */
  function watch(name, child) {
    const out = createWriteStream(logFile(name));
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
    child.on("exit", (code) => {
      if (stopped || died.has(name)) return;
      died.set(name, `exit code ${code}; see ${logFile(name)}`);
      // After start-up nothing is waiting on `died`, so the shell is told straight away.
      if (started) onFailure(name, died.get(name) ?? "");
    });
    children.push({ name, child });
  }

  /**
   * Starts one of the packaged Python programs. Its input is a pipe that is never written to:
   * when this process goes, however it goes, the pipe closes and the program ends itself
   * (EDDY_EXIT_WITH_PARENT, eddy_api/desktop.py). Nothing is left running without its shell.
   * @param {string} name
   * @param {string} command
   * @param {string[]} args
   * @param {NodeJS.ProcessEnv} extra
   */
  function startProgram(name, command, args, extra) {
    const child = spawn(command, args, {
      env: { ...env, ...extra, EDDY_EXIT_WITH_PARENT: "1" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", (error) => {
      if (!stopped && !died.has(name)) died.set(name, error.message);
    });
    watch(name, child);
  }

  /**
   * Starts one of the two JavaScript services.
   * @param {string} name
   * @param {string} script
   * @param {NodeJS.ProcessEnv} extra
   * @param {string} [cwd]
   */
  function startScript(name, script, extra, cwd) {
    watch(name, runNode(script, { env: { ...env, ...extra }, cwd }));
  }

  /**
   * Runs set-up to the end.
   * @param {string} command
   * @param {NodeJS.ProcessEnv} extra
   */
  function runSetup(command, extra) {
    return new Promise((resolve, reject) => {
      const out = createWriteStream(logFile("setup"));
      const child = spawn(command, ["setup"], {
        env: { ...env, ...extra },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      settingUp = child;
      child.stdout.pipe(out);
      child.stderr.pipe(out);
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Preparing the data took too long; see ${logFile("setup")}`));
      }, SETUP_TIMEOUT_MS);
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timer);
        settingUp = undefined;
        if (code === 0) resolve(undefined);
        else if (stopped) reject(new StoppedError());
        else if (code === NEWER_DATABASE) {
          reject(
            new Error(
              "This copy of Eddy is older than the one that last used this data. Install the newer Eddy to open it.",
            ),
          );
        } else {
          reject(
            new Error(`Preparing the data failed (exit code ${code}); see ${logFile("setup")}`),
          );
        }
      });
    });
  }

  try {
    // Logs are for finding out why the last start failed. Each start begins them again, so they
    // never grow without end and never outlive the data they might mention by long.
    rmSync(logs, { recursive: true, force: true });
    mkdirSync(logs, { recursive: true });
    if (clusterIsReady(cluster) && !existsSync(path.join(dataDir, SECRETS_FILE))) {
      // New passwords would not open the old database, and would hide that anything was wrong.
      throw new Error(
        `Eddy's database is in ${dataDir}, but the file that opens it (${SECRETS_FILE}) is missing. To start again with nothing saved, delete that folder.`,
      );
    }
    /** @type {import("./secrets.mjs").Secrets} */
    const secrets = {
      ...(await loadOrCreatePasswords(dataDir, codec)),
      ...createLaunchSecrets(),
    };
    const ports = { postgres: 0, api: 0, maths: 0, scenes: 0, web: 0 };

    log("Starting the database");
    await initCluster({ binDir, dataDir: cluster, password: secrets.ownerPassword, env });
    halt();
    // Each port is chosen just before its service takes it, so there is little time for
    // another program to take it first.
    ports.postgres = await freePort();
    const api = path.join(resources, "python", "eddy-api", "eddy-api.exe");
    // If this process is ended, not closed (Task Manager, a crash), Windows ends the programs
    // it started with it, but not the database: PostgreSQL is started through its own launcher.
    // So one small program is started apart from this one. It holds a pipe from here and waits;
    // when the pipe closes because this process has gone, it stops the database.
    watcher = spawn(api, ["watch-database"], {
      env: {
        ...env,
        EDDY_EXIT_WITH_PARENT: "1",
        EDDY_PG_CTL: path.join(binDir, "pg_ctl.exe"),
        EDDY_PG_DATA: cluster,
      },
      detached: true,
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    watcher.on("error", () => {});
    await startPostgres({
      binDir,
      dataDir: cluster,
      port: ports.postgres,
      logFile: logFile("postgres"),
      env,
    });
    halt();

    /** @type {NodeJS.ProcessEnv} What the API, its worker and its set-up share. */
    const apiEnv = {
      EDDY_HOME: path.join(resources, "data"),
      EDDY_LOCAL_MODE: "1",
      EDDY_ENVIRONMENT: environment,
      RUNTIME_DATABASE_URL: databaseUrl({
        user: RUNTIME_ROLE,
        password: secrets.runtimePassword,
        port: ports.postgres,
        database: DATABASE,
      }),
      // No Redis, no Claude and no local model: limits are counted in the API process, no key
      // is ever set, and typed chat stays off.
      REDIS_URL: "",
      ANTHROPIC_API_KEY: "",
      LLM_PROVIDER: "anthropic",
    };

    log("Preparing your data");
    // Only set-up is given the database owner's password: it makes the schema. The API and the
    // worker run as the runtime role, which cannot change the schema or the audit log.
    await runSetup(api, {
      ...apiEnv,
      DATABASE_URL: databaseUrl({
        user: OWNER,
        password: secrets.ownerPassword,
        port: ports.postgres,
        database: DATABASE,
      }),
    });
    halt();

    log("Starting Eddy");
    ports.maths = await freePort();
    startProgram(
      "maths",
      path.join(resources, "python", "eddy-maths", "eddy-maths.exe"),
      ["--port", String(ports.maths)],
      { MATHS_CORE_SERVICE_TOKEN: secrets.mathsToken },
    );
    ports.scenes = await freePort();
    startScript("scenes", path.join(resources, "scene-check", "server.mjs"), {
      SCENE_CHECK_SERVICE_TOKEN: secrets.sceneToken,
      SCENE_CHECK_PORT: String(ports.scenes),
    });
    ports.api = await freePort();
    startProgram("api", api, ["serve", "--port", String(ports.api)], {
      ...apiEnv,
      SERVICE_TOKEN_PUBLIC_KEY_B64: secrets.publicKeyB64,
      MATHS_CORE_BASE_URL: `http://${HOST}:${ports.maths}`,
      MATHS_CORE_SERVICE_TOKEN: secrets.mathsToken,
      SCENE_CHECK_BASE_URL: `http://${HOST}:${ports.scenes}`,
      SCENE_CHECK_SERVICE_TOKEN: secrets.sceneToken,
    });
    // The worker only runs the privacy jobs: it needs the database and nothing else.
    startProgram("worker", api, ["worker"], apiEnv);
    ports.web = await freePort();
    const webUrl = `http://${HOST}:${ports.web}`;
    const webDir = path.join(resources, "web", "apps", "web");
    startScript(
      "web",
      path.join(webDir, "server.js"),
      {
        NODE_ENV: "production",
        PORT: String(ports.web),
        HOSTNAME: HOST,
        EDDY_LOCAL_MODE: "1",
        EDDY_WINDOW_SECRET: secrets.windowSecret,
        AUTH_SECRET: secrets.authSecret,
        AUTH_URL: webUrl,
        API_BASE_URL: `http://${HOST}:${ports.api}`,
        SERVICE_TOKEN_PRIVATE_KEY_B64: secrets.privateKeyB64,
      },
      webDir,
    );

    await Promise.all([
      waitFor(`http://${HOST}:${ports.maths}/health`, "maths-core", alive("maths")),
      waitFor(`http://${HOST}:${ports.scenes}/health`, "scene-check", alive("scenes")),
      waitFor(`http://${HOST}:${ports.api}/health`, "the API", alive("api")),
    ]);
    await waitFor(`${webUrl}/privacy`, "the web app", alive("web"), {
      cookie: `${WINDOW_COOKIE}=${secrets.windowSecret}`,
    });

    // If another program took a port first, it is that program which answered the health check,
    // and our own service is about to exit because the port is taken. So every one of them, the
    // worker included, must still be running a moment later, or Eddy does not start.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    for (const { name } of children) alive(name)();
    started = true;
    return { webUrl, ports, secrets, stop };
  } catch (error) {
    await stop();
    // Closed in the middle of starting the database: the step in flight may have finished
    // after `stop` looked. Stopping it again is harmless when there is nothing to stop.
    await stopPostgres({ binDir, dataDir: cluster, env });
    watcher?.kill();
    throw error;
  }
}
