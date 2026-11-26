// Starts and stops everything the desktop app runs (ADR-0036), all on 127.0.0.1 with ports chosen
// at each start and secrets made for this install:
//
//   PostgreSQL -> eddy-api setup -> maths-core, scene-check -> the API and its worker -> the web
//
// The Electron shell calls this; so does the test that runs the built parts without a window.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { databaseUrl, initCluster, OWNER, startPostgres, stopPostgres } from "./postgres.mjs";
import { loadOrCreateSecrets } from "./secrets.mjs";

const HOST = "127.0.0.1";
const RUNTIME_ROLE = "eddy_app";
const DATABASE = "eddy";

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
 * @param {() => string | null} failed says why the service died, if it has
 */
async function waitFor(url, name, failed, seconds = 90) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const reason = failed();
    if (reason) throw new Error(`${name} stopped while starting: ${reason}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
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
 * @param {string} options.dataDir this install's data: the database, secrets and logs
 * @param {{ command: string, env?: NodeJS.ProcessEnv }} options.node what runs JavaScript: Node,
 *   or the Electron program itself with ELECTRON_RUN_AS_NODE set
 * @param {"development" | "production"} options.environment `development` for a preview build:
 *   the tutor stays locked in production until the safeguarding script is approved
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<Running>}
 */
export async function startServices({ resources, dataDir, node, environment, log = () => {} }) {
  const env = baseEnv();
  const logs = path.join(dataDir, "logs");
  mkdirSync(logs, { recursive: true });
  const secrets = loadOrCreateSecrets(dataDir);
  const ports = {
    postgres: await freePort(),
    api: await freePort(),
    maths: await freePort(),
    scenes: await freePort(),
    web: await freePort(),
  };

  const binDir = path.join(resources, "postgres", "bin");
  const cluster = path.join(dataDir, "postgres");
  /** @type {{ name: string, child: import("node:child_process").ChildProcess }[]} */
  const children = [];
  /** @type {Map<string, string>} */
  const died = new Map();
  let stopped = false;

  async function stop() {
    if (stopped) return;
    stopped = true;
    // The web first, the database last: nothing is left talking to something already gone.
    for (const { child } of [...children].reverse()) child.kill();
    await stopPostgres({ binDir, dataDir: cluster, env });
  }

  /**
   * @param {string} name
   * @param {string} command
   * @param {string[]} args
   * @param {NodeJS.ProcessEnv} extra
   * @param {string} [cwd]
   */
  function start(name, command, args, extra, cwd) {
    const out = createWriteStream(path.join(logs, `${name}.log`), { flags: "a" });
    const child = spawn(command, args, {
      cwd,
      env: { ...env, ...extra },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on("exit", (code) => {
      if (!stopped) died.set(name, `exit code ${code}; see ${path.join(logs, `${name}.log`)}`);
    });
    child.on("error", (error) => died.set(name, error.message));
    children.push({ name, child });
    return child;
  }

  /** @param {string} name @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} extra */
  function runToEnd(name, command, args, extra) {
    return new Promise((resolve, reject) => {
      const out = createWriteStream(path.join(logs, `${name}.log`), { flags: "a" });
      const child = spawn(command, args, {
        env: { ...env, ...extra },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.pipe(out);
      child.stderr.pipe(out);
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve(undefined)
          : reject(
              new Error(
                `${name} failed (exit code ${code}); see ${path.join(logs, `${name}.log`)}`,
              ),
            ),
      );
    });
  }

  try {
    log("Starting the database");
    await initCluster({ binDir, dataDir: cluster, password: secrets.ownerPassword, env });
    await startPostgres({
      binDir,
      dataDir: cluster,
      port: ports.postgres,
      logFile: path.join(logs, "postgres.log"),
      env,
    });

    const api = path.join(resources, "python", "eddy-api", "eddy-api.exe");
    /** @type {NodeJS.ProcessEnv} */
    const apiEnv = {
      EDDY_HOME: path.join(resources, "data"),
      EDDY_LOCAL_MODE: "1",
      EDDY_ENVIRONMENT: environment,
      DATABASE_URL: databaseUrl({
        user: OWNER,
        password: secrets.ownerPassword,
        port: ports.postgres,
        database: DATABASE,
      }),
      RUNTIME_DATABASE_URL: databaseUrl({
        user: RUNTIME_ROLE,
        password: secrets.runtimePassword,
        port: ports.postgres,
        database: DATABASE,
      }),
      SERVICE_TOKEN_PUBLIC_KEY_B64: secrets.publicKeyB64,
      MATHS_CORE_BASE_URL: `http://${HOST}:${ports.maths}`,
      MATHS_CORE_SERVICE_TOKEN: secrets.mathsToken,
      SCENE_CHECK_BASE_URL: `http://${HOST}:${ports.scenes}`,
      SCENE_CHECK_SERVICE_TOKEN: secrets.sceneToken,
      // No Redis and no Claude: limits are counted in the API process, and no key is ever set.
      REDIS_URL: "",
      ANTHROPIC_API_KEY: "",
    };

    log("Preparing your data");
    await runToEnd("setup", api, ["setup"], apiEnv);

    log("Starting Eddy");
    start(
      "maths",
      path.join(resources, "python", "eddy-maths", "eddy-maths.exe"),
      ["--port", String(ports.maths)],
      { MATHS_CORE_SERVICE_TOKEN: secrets.mathsToken },
    );
    start("scenes", node.command, [path.join(resources, "scene-check", "server.mjs")], {
      ...node.env,
      SCENE_CHECK_SERVICE_TOKEN: secrets.sceneToken,
      SCENE_CHECK_PORT: String(ports.scenes),
    });
    start("api", api, ["serve", "--port", String(ports.api)], apiEnv);
    start("worker", api, ["worker"], apiEnv);
    const webDir = path.join(resources, "web", "apps", "web");
    const webUrl = `http://${HOST}:${ports.web}`;
    start(
      "web",
      node.command,
      ["server.js"],
      {
        ...node.env,
        NODE_ENV: "production",
        PORT: String(ports.web),
        HOSTNAME: HOST,
        EDDY_LOCAL_MODE: "1",
        AUTH_SECRET: secrets.authSecret,
        AUTH_URL: webUrl,
        API_BASE_URL: `http://${HOST}:${ports.api}`,
        SERVICE_TOKEN_PRIVATE_KEY_B64: secrets.privateKeyB64,
      },
      webDir,
    );

    const why = (/** @type {string} */ name) => () => died.get(name) ?? null;
    await Promise.all([
      waitFor(`http://${HOST}:${ports.maths}/health`, "maths-core", why("maths")),
      waitFor(`http://${HOST}:${ports.scenes}/health`, "scene-check", why("scenes")),
      waitFor(`http://${HOST}:${ports.api}/health`, "the API", why("api")),
    ]);
    await waitFor(`${webUrl}/privacy`, "the web app", why("web"));
    return { webUrl, ports, secrets, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
