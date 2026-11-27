// pnpm --filter @eddy/desktop dist            the set-up program for students
// pnpm --filter @eddy/desktop dist:preview    the same, as a preview build
//
// Runs electron-builder over what `pnpm build` made. A preview build opens the tutor before the
// safeguarding help script is approved, so it is made only when asked for by name
// (electron-builder.config.mjs).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { desktopDir, resourcesDir } from "./paths.mjs";

const preview = process.argv.includes("--preview");

for (const part of ["web", "scene-check", "python", "postgres", "data"]) {
  if (!existsSync(path.join(resourcesDir, part))) {
    console.error(`dist: resources/${part} is missing. Run pnpm --filter @eddy/desktop build.`);
    process.exit(1);
  }
}

const built = spawnSync(
  "pnpm",
  ["exec", "electron-builder", "--config", "electron-builder.config.mjs", "--win"],
  {
    cwd: desktopDir,
    env: { ...process.env, EDDY_DESKTOP_PREVIEW: preview ? "1" : "0" },
    stdio: "inherit",
    shell: true,
  },
);
if (built.status === 0) {
  console.log(
    preview ? "dist: a PREVIEW build (the tutor is open)." : "dist: a build for students.",
  );
}
process.exit(built.status ?? 1);
