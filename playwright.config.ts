import { generateKeyPairSync } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3301;
const API_PORT = 8301;

// A fresh service-token key pair per run, so E2E never depends on local .env files.
// The config is also loaded by workers; only the main process starts the servers, so only its
// key pair is used.
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const b64 = (pem: string) => Buffer.from(pem, "utf8").toString("base64");

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
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
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
      command: `uv run --package eddy-api uvicorn eddy_api.main:app --host 127.0.0.1 --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: withEnv({ SERVICE_TOKEN_PUBLIC_KEY_B64: b64(publicKey) }),
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
      }),
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
