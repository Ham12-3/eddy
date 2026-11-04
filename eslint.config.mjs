// Root files only (scripts, hooks, E2E). Each workspace package lints itself with its own config.
import { defineConfig, globalIgnores } from "eslint/config";
import base from "./eslint.config.base.mjs";

export default defineConfig([
  globalIgnores([
    "apps/",
    "packages/",
    "workers/",
    "infra/",
    "services/",
    "docs/",
    ".venv/",
    "e2e-artifacts/",
    "playwright-report/",
    "test-results/",
  ]),
  base,
]);
