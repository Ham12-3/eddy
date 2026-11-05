import { expect, test } from "@playwright/test";
import { openStory } from "./story";

// Behaviour does not change with viewport or theme, so run these once.
// Playwright requires a destructuring pattern for fixtures, even an empty one.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light", "behaviour checks run once");
});

test("MathField works by keyboard alone and is named for screen readers", async ({
  page,
}, testInfo) => {
  await openStory(page, testInfo, "design-system-learning--math-input");
  const field = page.locator("math-field");

  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await expect(field).toHaveAccessibleName("Your answer");
  await expect(field).toHaveAccessibleDescription("Type / for a fraction, ^ for a power.");

  await page.keyboard.type("1/2");
  // MathLive may write the compact \frac12 for \frac{1}{2}; both mean one half.
  await expect(page.getByTestId("latex-value")).toHaveText(/^LaTeX: \\frac(12|\{1\}\{2\})$/);

  // MathLive speaks the maths through a live region inside its shadow root.
  const spoken = await field.evaluate((element) => {
    const live = element.shadowRoot?.querySelector("[aria-live]");
    return live?.textContent ?? "";
  });
  expect(spoken.trim().length, `live region said: "${spoken}"`).toBeGreaterThan(0);

  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("latex-value")).toHaveText("LaTeX: (empty)");
});

test("Dialog traps focus, closes with Escape and returns focus", async ({ page }, testInfo) => {
  await openStory(page, testInfo, "design-system-structure--dialog-and-sheet");
  const opener = page.getByRole("button", { name: "Open dialog" });
  await opener.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Good place to stop" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("dialog[open] :focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("Toggle and confidence picker work from the keyboard", async ({ page }, testInfo) => {
  await openStory(page, testInfo, "design-system-structure--forms");
  const toggle = page.getByRole("switch", { name: "Reduce motion" });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await openStory(page, testInfo, "design-system-learning--confidence");
  const fairlySure = page.getByRole("radio", { name: "Fairly sure" });
  await fairlySure.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Certain" })).toBeChecked();
});
