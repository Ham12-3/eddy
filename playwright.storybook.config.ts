import { defineConfig, devices } from "@playwright/test";

/**
 * Design-system checks against the static Storybook build (PLAN.md M1): every story, at 375, 768
 * and 1280 px, in light, dark, reduced motion and dyslexia mode, with axe and a screenshot each.
 * Run with `pnpm e2e:storybook`, which builds Storybook first.
 */
const PORT = 6107;

const viewports = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 900 },
} as const;

const modes = {
  light: { use: { colorScheme: "light" }, globals: "" },
  dark: { use: { colorScheme: "dark" }, globals: "" },
  "reduced-motion": {
    use: { colorScheme: "light", reducedMotion: "reduce" },
    globals: "motion:reduce",
  },
  dyslexia: { use: { colorScheme: "light" }, globals: "reading:dyslexia" },
} as const;

export default defineConfig({
  testDir: "e2e-storybook",
  // MathLive loading plus axe on a busy CI runner can take a while.
  timeout: 60_000,
  outputDir: "test-results/storybook",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report/storybook" }]]
    : [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    ...Object.entries(viewports).flatMap(([viewportName, viewport]) =>
      Object.entries(modes).map(([modeName, mode]) => ({
        name: `${viewportName}-${modeName}`,
        metadata: { globals: mode.globals },
        use: { ...devices["Desktop Chrome"], viewport, ...mode.use },
      })),
    ),
    // The in-app theme switch overriding a light system setting, and dyslexia mode on dark.
    {
      name: "desktop-forced-dark",
      metadata: { globals: "theme:dark" },
      use: { ...devices["Desktop Chrome"], viewport: viewports.desktop, colorScheme: "light" },
    },
    {
      name: "desktop-dark-dyslexia",
      metadata: { globals: "reading:dyslexia" },
      use: { ...devices["Desktop Chrome"], viewport: viewports.desktop, colorScheme: "dark" },
    },
  ],
  webServer: {
    command: `pnpm exec http-server packages/ui/storybook-static -a 127.0.0.1 -p ${PORT} -s -c-1`,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
