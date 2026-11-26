// Stands in for Playwright in the desktop app's scene-check bundle. Keyframes are drawn only for
// Tier L scenes, which the desktop app does not make (ADR-0036), so no browser is shipped.
export const chromium = {
  launch() {
    throw new Error("The desktop app does not draw keyframes: Tier L scenes are off.");
  },
};
