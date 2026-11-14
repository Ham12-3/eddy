import { generateKeyPairSync, randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3301;
const API_PORT = 8301;
const GATED_PORT = 3302;
// E2E has its own database, so it never migrates or reseeds the developer's.
const E2E_DATABASE_URL = "postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy_e2e";
// The API connects as the runtime role, as it does everywhere (ADR-0024).
const E2E_RUNTIME_DATABASE_URL = "postgresql+psycopg://eddy_app:eddy_app@127.0.0.1:5442/eddy_e2e";

// A fresh service-token key pair per run, so E2E never depends on local .env files.
// The config is also loaded by workers; only the main process starts the servers, so only its
// key pair is used.
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const b64 = (pem: string) => Buffer.from(pem, "utf8").toString("base64");
const MATHS_PORT = 8311;
const mathsToken = randomBytes(32).toString("base64url");
const authSecret = randomBytes(32).toString("base64url");
// The invite every E2E sign-up uses (created by the API server's start command; e2e/helpers.ts).
const E2E_INVITE = "E2E-JOURNEY";

function withEnv(extra: Record<string, string>): Record<string, string> {
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return { ...Object.fromEntries(inherited), ...extra };
}

// SPEC.md: every UI change is checked at 375, 768 and 1280 px in light, dark and reduced motion.
const viewports = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;
const modes = {
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
  "reduced-motion": { colorScheme: "light", reducedMotion: "reduce" },
} as const;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Sign-up steps send email and the lesson starts the tutor: with nine browsers at once they
  // can take longer than the 5-second default.
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    // localhost, not 127.0.0.1: Next.js reports 127.0.0.1 as localhost, so Auth.js would
    // redirect there and the session cookie would sit on the other host.
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: Object.entries(viewports).flatMap(([viewportName, viewport]) =>
    Object.entries(modes).map(([modeName, mode]) => ({
      name: `${viewportName}-${modeName}`,
      use: { ...devices["Desktop Chrome"], viewport, ...mode },
    })),
  ),
  webServer: [
    {
      // Its own eddy_e2e database, created, migrated and seeded first: the admin pages read the
      // seeded curriculum, and the developer's eddy database is never touched.
      command: `uv run --package eddy-api python -m eddy_api.db.local && pnpm db:migrate && pnpm db:seed && uv run --package eddy-api python -m eddy_api.invites ${E2E_INVITE} --cohort e2e --uses 5000 && uv run --package eddy-api uvicorn eddy_api.main:app --host 127.0.0.1 --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: withEnv({
        SERVICE_TOKEN_PUBLIC_KEY_B64: b64(publicKey),
        DATABASE_URL: E2E_DATABASE_URL,
        RUNTIME_DATABASE_URL: E2E_RUNTIME_DATABASE_URL,
        MATHS_CORE_BASE_URL: `http://127.0.0.1:${MATHS_PORT}`,
        MATHS_CORE_SERVICE_TOKEN: mathsToken,
        // The tutor runs (test environment) but never calls Claude: templated messages only,
        // so E2E costs nothing and needs no key.
        EDDY_ENVIRONMENT: "test",
        ANTHROPIC_API_KEY: "",
        // Every parallel E2E browser shares one address, so the per-visitor sign-up limit is raised.
        SIGNUP_LIMIT_SCALE: "100",
      }),
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `uv run --package eddy-maths-core uvicorn eddy_maths_core.main:app --host 127.0.0.1 --port ${MATHS_PORT}`,
      url: `http://127.0.0.1:${MATHS_PORT}/health`,
      env: withEnv({ MATHS_CORE_SERVICE_TOKEN: mathsToken }),
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @eddy/web build && pnpm --filter @eddy/web exec next start --hostname 127.0.0.1 --port ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: withEnv({
        SERVICE_TOKEN_PRIVATE_KEY_B64: b64(privateKey),
        API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        EDDY_SYSTEM_CHECK: "1", // the production build hides the check otherwise
        EDDY_ADMIN_PREVIEW: "1", // and the admin pages
        AUTH_SECRET: authSecret,
        AUTH_URL: `http://localhost:${WEB_PORT}`,
        // Mailpit (compose.yaml, and a CI service): the journey reads its sign-in links there.
        EMAIL_SERVER: "smtp://127.0.0.1:1025",
      }),
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      // The same production build without the preview flag: the admin pages must not exist.
      command: `pnpm --filter @eddy/web exec next start --hostname 127.0.0.1 --port ${GATED_PORT}`,
      url: `http://127.0.0.1:${GATED_PORT}`,
      env: withEnv({ API_BASE_URL: `http://127.0.0.1:${API_PORT}`, EDDY_ADMIN_PREVIEW: "0" }),
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
