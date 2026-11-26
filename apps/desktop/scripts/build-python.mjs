// pnpm --filter @eddy/desktop build:python
//
// Packages the two Python services as programs that need no Python on the student's computer:
//   resources/python/eddy-api/eddy-api.exe      setup | serve --port N | worker
//   resources/python/eddy-maths/eddy-maths.exe  --port N
// and copies the files the API reads at run time (EDDY_HOME) into resources/data.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { cacheDir, desktopDir, repoRoot, resourcesDir } from "./paths.mjs";

const dist = path.join(resourcesDir, "python");
const work = path.join(cacheDir, "pyinstaller");

/** @type {{ name: string, entry: string, extra: string[] }[]} */
const programs = [
  {
    name: "eddy-api",
    entry: "eddy_api_main.py",
    extra: [
      // Loaded by name at run time, so PyInstaller cannot see them by reading the imports.
      ...["psycopg", "psycopg_binary"].flatMap((name) => ["--collect-all", name]),
      ...["eddy_api", "langgraph", "uvicorn"].flatMap((name) => ["--collect-submodules", name]),
      // The JSON Schema drafts the curriculum check validates against.
      ...["jsonschema", "jsonschema_specifications"].flatMap((name) => ["--collect-data", name]),
    ],
  },
  {
    name: "eddy-maths",
    entry: "eddy_maths_main.py",
    extra: ["eddy_maths_core", "uvicorn"].flatMap((name) => ["--collect-submodules", name]),
  },
];

/** Test and lint tools, and uvicorn's file watcher, which only its reload mode uses. */
const EXCLUDED = ["hypothesis", "mypy", "pytest", "_pytest", "ruff", "watchfiles", "IPython"];

const only = process.argv.slice(2);
mkdirSync(work, { recursive: true });
for (const program of programs) {
  if (only.length && !only.includes(program.name)) continue;
  rmSync(path.join(dist, program.name), { recursive: true, force: true });
  const built = spawnSync(
    "uv",
    [
      "run",
      "pyinstaller",
      "--noconfirm",
      "--clean",
      "--onedir",
      "--console",
      "--log-level",
      "WARN",
      "--name",
      program.name,
      "--distpath",
      dist,
      "--workpath",
      path.join(work, program.name),
      "--specpath",
      work,
      // Development tools that are installed beside the services and are no part of them.
      ...EXCLUDED.flatMap((name) => ["--exclude-module", name]),
      ...program.extra,
      path.join(desktopDir, "python", program.entry),
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (built.status !== 0) process.exit(built.status ?? 1);
  const exe = path.join(dist, program.name, `${program.name}.exe`);
  if (!existsSync(exe)) {
    console.error(`python: ${exe} was not made`);
    process.exit(1);
  }
  console.log(`python: ${exe}`);
}

// What the API reads at run time. The program finds it through EDDY_HOME (eddy_api/desktop.py).
const data = path.join(resourcesDir, "data");
rmSync(data, { recursive: true, force: true });
/** @type {[string, string][]} */
const copies = [
  ["config", "config"],
  ["prompts", "prompts"],
  ["curriculum", "curriculum"],
  ["services/api/migrations", "migrations"],
];
for (const [from, to] of copies) {
  cpSync(path.join(repoRoot, from), path.join(data, to), {
    recursive: true,
    filter: (source) => path.basename(source) !== "__pycache__",
  });
}
console.log(`python: ${data}`);
