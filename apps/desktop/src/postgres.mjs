// The desktop app's private PostgreSQL (ADR-0036): one cluster in the user's app-data folder,
// listening on 127.0.0.1 only, on a port chosen at each start.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const OWNER = "eddy";

/**
 * Runs one of PostgreSQL's programs to the end.
 * @param {string} program
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ code: number, output: string }>}
 */
function run(program, args, env) {
  return new Promise((resolve, reject) => {
    // Detached output: pg_ctl leaves the server running, and it must not hold our pipes open.
    const child = spawn(program, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, output }));
  });
}

/**
 * Makes the cluster the first time Eddy runs. True if it was made now.
 * @param {{ binDir: string, dataDir: string, password: string, env: NodeJS.ProcessEnv }} options
 */
export async function initCluster({ binDir, dataDir, password, env }) {
  if (existsSync(path.join(dataDir, "PG_VERSION"))) return false;
  // A half-made cluster (Eddy closed during first run) is started again from nothing.
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(path.dirname(dataDir), { recursive: true });
  // initdb reads the owner's password from a file, so it is never on a command line.
  const passwordFile = `${dataDir}.pw`;
  writeFileSync(passwordFile, password, { mode: 0o600 });
  try {
    const made = await run(
      path.join(binDir, "initdb.exe"),
      [
        "-D",
        dataDir,
        "-U",
        OWNER,
        `--pwfile=${passwordFile}`,
        // A password for every connection, even from this computer: other programs and other
        // Windows accounts can reach a local port.
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
      ],
      env,
    );
    if (made.code !== 0) throw new Error(`initdb failed:\n${made.output}`);
  } finally {
    rmSync(passwordFile, { force: true });
  }
  return true;
}

/**
 * Starts the server and waits until it accepts connections.
 * @param {{ binDir: string, dataDir: string, port: number, logFile: string, env: NodeJS.ProcessEnv }} options
 */
export async function startPostgres({ binDir, dataDir, port, logFile, env }) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const started = await run(
    path.join(binDir, "pg_ctl.exe"),
    [
      "start",
      "-D",
      dataDir,
      "-l",
      logFile,
      "-w",
      "-t",
      "60",
      "-o",
      // Never reachable from another computer, and small: one family, a handful of connections.
      `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=40 -c shared_buffers=64MB`,
    ],
    env,
  );
  if (started.code !== 0) throw new Error(`PostgreSQL did not start:\n${started.output}`);
}

/**
 * Stops the server cleanly. Safe to call when it is not running.
 * @param {{ binDir: string, dataDir: string, env: NodeJS.ProcessEnv }} options
 */
export async function stopPostgres({ binDir, dataDir, env }) {
  if (!existsSync(path.join(dataDir, "postmaster.pid"))) return;
  await run(
    path.join(binDir, "pg_ctl.exe"),
    ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"],
    env,
  );
}

/**
 * @param {{ user: string, password: string, port: number, database: string }} options
 * @returns {string} the URL SQLAlchemy connects with
 */
export function databaseUrl({ user, password, port, database }) {
  return `postgresql+psycopg://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}
