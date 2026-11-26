// Where the desktop build reads from and writes to.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(desktopDir, "../..");
/** Everything the installer ships besides the Electron shell itself. Git-ignored. */
export const resourcesDir = path.join(desktopDir, "resources");
/** Downloads and intermediate build folders. Git-ignored. */
export const cacheDir = path.join(desktopDir, ".cache");
