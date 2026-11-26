// pnpm --filter @eddy/desktop build:shell
//
// The window shows a plain page while the services start. It takes its colours from the design
// tokens, like everything else: this copies the token stylesheet beside it, so no colour is
// written down a second time.
import { copyFileSync } from "node:fs";
import path from "node:path";

import { desktopDir, repoRoot } from "./paths.mjs";

const from = path.join(repoRoot, "packages/ui/src/styles/tokens.css");
const to = path.join(desktopDir, "src/tokens.css");
copyFileSync(from, to);
console.log(`shell: ${to}`);
