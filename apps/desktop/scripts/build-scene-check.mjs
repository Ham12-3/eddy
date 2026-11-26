// pnpm --filter @eddy/desktop build:scene-check
//
// Bundles workers/scene-check into one file the desktop app runs with its own Node (Electron's).
// The service is written in TypeScript and run through tsx in development; a student's computer
// has neither. Playwright is swapped for a stub: only Tier L keyframes need a browser.
import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { build } from "esbuild";

import { desktopDir, repoRoot, resourcesDir } from "./paths.mjs";

const outDir = path.join(resourcesDir, "scene-check");
const outfile = path.join(outDir, "server.mjs");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(repoRoot, "workers/scene-check/src/server.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  jsx: "automatic",
  alias: { playwright: path.join(desktopDir, "scripts/stubs/playwright.mjs") },
  define: { "process.env.NODE_ENV": '"production"' },
  // React's server renderer is CommonJS and calls require() for Node built-ins.
  banner: {
    js: 'import { createRequire as __eddyCreateRequire } from "node:module";\nconst require = __eddyCreateRequire(import.meta.url);',
  },
  legalComments: "none",
  logLevel: "warning",
});

console.log(`scene-check: ${outfile} (${Math.round(statSync(outfile).size / 1024)} kB)`);
