// pnpm --filter @eddy/desktop build:web
//
// Builds apps/web as a self-contained server (Next.js "standalone" output) and copies it, with
// its static files, into the desktop app's resources. The result runs with plain Node:
//   node resources/web/apps/web/server.js   (PORT, HOSTNAME, EDDY_LOCAL_MODE=1 and the secrets)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { repoRoot, resourcesDir } from "./paths.mjs";

const web = path.join(repoRoot, "apps/web");
const built = path.join(web, ".next-desktop");
const standalone = path.join(built, "standalone");
const out = path.join(resourcesDir, "web");
const app = path.join(out, "apps/web");

const build = spawnSync("pnpm", ["exec", "next", "build"], {
  cwd: web,
  // EDDY_DESKTOP_BUILD switches next.config.ts to the standalone output in its own folder.
  env: { ...process.env, EDDY_DESKTOP_BUILD: "1", EDDY_LOCAL_MODE: "1" },
  stdio: "inherit",
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(out, { recursive: true, force: true });
// Everything but node_modules is plain files: the server, its compiled pages and manifests.
cpSync(path.join(standalone, "apps"), path.join(out, "apps"), {
  recursive: true,
  filter: (source) => path.basename(source) !== "node_modules",
});
cpSync(path.join(built, "static"), path.join(app, ".next-desktop/static"), { recursive: true });
if (existsSync(path.join(web, "public"))) {
  cpSync(path.join(web, "public"), path.join(app, "public"), { recursive: true });
}

// pnpm lays node_modules out as links into a store, and each package finds its dependencies
// beside its real location. An installer cannot carry links, so the packages are laid out again
// as plain folders: at the top where there is no clash, nested under the package that needs them
// where two versions of one name are wanted.
/** Where each copied package came from: destination folder to its real source folder. */
const placed = new Map();

/** @param {string} nodeModules @returns {{ name: string, source: string }[]} */
function packagesIn(nodeModules) {
  const found = [];
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(nodeModules, entry);
    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(full)) {
        found.push({ name: `${entry}/${scoped}`, source: realpathSync(path.join(full, scoped)) });
      }
    } else {
      found.push({ name: entry, source: realpathSync(full) });
    }
  }
  return found;
}

/** The folder Node would load `name` from for code in `from`, among what is copied so far. */
function resolveFrom(/** @type {string} */ from, /** @type {string} */ name) {
  for (let dir = from; dir.startsWith(out); dir = path.dirname(dir)) {
    if (path.basename(dir) === "node_modules") continue;
    const candidate = path.join(dir, "node_modules", name);
    if (placed.has(candidate)) return candidate;
    if (dir === out) break;
  }
  return null;
}

/** Copies one package where `requester` will find it, then the packages it depends on. */
function place(
  /** @type {string} */ name,
  /** @type {string} */ source,
  /** @type {string} */ requester,
) {
  const found = resolveFrom(requester, name);
  if (found && placed.get(found) === source) return;
  // No package of this name in reach: it goes at the top. Another version is: nest this one.
  const target = found
    ? path.join(requester, "node_modules", name)
    : path.join(out, "node_modules", name);
  cpSync(source, target, { recursive: true, dereference: true });
  placed.set(target, source);
  // In pnpm's store a package's dependencies are its neighbours.
  const neighbours = name.startsWith("@")
    ? path.dirname(path.dirname(source))
    : path.dirname(source);
  for (const dependency of packagesIn(neighbours)) {
    if (dependency.source !== source) place(dependency.name, dependency.source, target);
  }
}

for (const top of packagesIn(path.join(standalone, "apps/web/node_modules"))) {
  place(top.name, top.source, app);
}

if (!existsSync(path.join(app, "server.js"))) {
  console.error("web: the build has no server.js. Is output: standalone still set?");
  process.exit(1);
}

/** @param {string} dir @returns {number} */
function size(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? size(full) : statSync(full).size;
  }
  return total;
}
console.log(`web: ${app} (${placed.size} packages, ${Math.round(size(out) / 1024 / 1024)} MB)`);
