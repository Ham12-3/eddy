// The desktop app's private PostgreSQL (ADR-0036): one cluster in the user's app-data folder,
// listening on 127.0.0.1 only, on a port chosen at each start.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
 * Whether a finished cluster is in `dataDir`. A cluster is made under another name and only
 * given this one once initdb has finished, so the folder's existence is the proof.
 * @param {string} dataDir
 */
export function clusterIsReady(dataDir) {
  return existsSync(path.join(dataDir, "PG_VERSION"));
}

/**
 * Makes the cluster the first time Eddy runs. True if it was made now.
 *
 * initdb works in `<dataDir>.new`, which becomes `dataDir` only when it has finished. If Eddy is
 * closed or the power goes part-way, the next start finds no `dataDir`, clears the leftover and
 * begins again. A finished cluster is never deleted from here: it is a student's work.
 * @param {{ binDir: string, dataDir: string, password: string, env: NodeJS.ProcessEnv }} options
 */
export async function initCluster({ binDir, dataDir, password, env }) {
  const making = `${dataDir}.new`;
  // initdb reads the owner's password from a file, so it is never on a command line.
  const passwordFile = `${dataDir}.pw`;
  rmSync(passwordFile, { force: true });
  rmSync(making, { recursive: true, force: true });
  if (existsSync(dataDir)) {
    if (clusterIsReady(dataDir)) return false;
    throw new Error(
      `${dataDir} exists but is not a database Eddy can open. Eddy has left it as it is.`,
    );
  }
  mkdirSync(path.dirname(dataDir), { recursive: true });
  writeFileSync(passwordFile, password, { mode: 0o600 });
  try {
    const made = await run(
      path.join(binDir, "initdb.exe"),
      [
        "-D",
        making,
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
    if (made.code !== 0) {
      throw new Error(
        `The database could not be made (initdb, exit code ${made.code}).\n${made.output || "It printed nothing, which usually means a Windows component it needs is missing."}`,
      );
    }
  } finally {
    rmSync(passwordFile, { force: true });
  }
  renameSync(making, dataDir);
  return true;
}

/**
 * Starts the server and waits until it accepts connections.
 * @param {{ binDir: string, dataDir: string, port: number, logFile: string, env: NodeJS.ProcessEnv }} options
 */
export async function startPostgres({ binDir, dataDir, port, logFile, env }) {
  // A server left running on this folder (Eddy was ended, not closed) is stopped first: two
  // cannot share one cluster, and the new one would fail on its lock file.
  await stopPostgres({ binDir, dataDir, env });
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
