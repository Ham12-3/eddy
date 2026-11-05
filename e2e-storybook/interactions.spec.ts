import { expect, test, type Page } from "@playwright/test";
import { openStory } from "./story";

// Behaviour does not change with viewport or theme, so run these once.
// Playwright requires a destructuring pattern for fixtures, even an empty one.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light", "behaviour checks run once");
});

/** What a screen reader gets from the element that really has focus inside MathLive's shadow DOM. */
async function focusedMathTextbox(page: Page) {
  return page.evaluate(() => {
    const host = document.activeElement;
    const inner = host?.shadowRoot?.activeElement;
    return {
      host: host?.tagName.toLowerCase(),
      role: inner?.getAttribute("role"),
      label: inner?.getAttribute("aria-label"),
      description: inner?.getAttribute("aria-description"),
      invalid: inner?.getAttribute("aria-invalid"),
    };
  });
}

test("MathField works by keyboard alone and tells screen readers its name and hint", async ({
  page,
}, testInfo) => {
  await openStory(page, testInfo, "design-system-learning--math-input");
  const field = page.locator("math-field");

  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  expect(await focusedMathTextbox(page)).toEqual({
    host: "math-field",
    role: "textbox",
    label: "Your answer",
    description: "Type / for a fraction, ^ for a power.",
    invalid: null,
  });

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

test("MathField reports an error as invalid, with the error as its description", async ({
  page,
}, testInfo) => {
  await openStory(page, testInfo, "design-system-learning--math-input-with-error");
  await page.keyboard.press("Tab");
  const textbox = await focusedMathTextbox(page);
  expect(textbox.invalid).toBe("true");
  expect(textbox.description).toBe("Check the denominators.");
  await expect(
    page.locator("[aria-live='polite']", { hasText: "Check the denominators." }),
  ).toHaveCount(1);
});

test("Clicking the MathField label focuses the field", async ({ page }, testInfo) => {
  await openStory(page, testInfo, "design-system-learning--math-input");
  await page.getByText("Your answer", { exact: true }).click();
  await expect(page.locator("math-field")).toBeFocused();
});

test("Dialog keeps focus off the page behind it, closes with Escape and returns focus", async ({
  page,
}, testInfo) => {
  await openStory(page, testInfo, "design-system-structure--dialog-and-sheet");
  const opener = page.getByRole("button", { name: "Open dialog" });
  await opener.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Good place to stop" });
  await expect(dialog).toBeVisible();
  // Tab more times than the dialog has controls. The page behind is inert: focus is always in
  // the dialog, or (native <dialog> behaviour) briefly in the browser's own toolbar, which
  // leaves document.activeElement on <body>. It must never land on the page's own controls.
  const visited = new Set<string>();
  for (let press = 0; press < 8; press++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return "browser";
      return active.closest("dialog[open]") ? `dialog:${active.textContent ?? ""}` : "page";
    });
    expect(where, `Tab ${press + 1} reached the page behind the dialog`).not.toBe("page");
    visited.add(where);
  }
  // It cycles through all three dialog controls.
  expect([...visited].filter((place) => place.startsWith("dialog:"))).toHaveLength(3);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("A busy button keeps keyboard focus", async ({ page }, testInfo) => {
  await openStory(page, testInfo, "design-system-actions--busy-button");
  const button = page.getByRole("button", { name: "Check my answer" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toBeFocused();
});

test("Toggle and confidence picker work from the keyboard", async ({ page }, testInfo) => {
  await openStory(page, testInfo, "design-system-structure--forms");
  const toggle = page.getByRole("switch", { name: "Reduce motion", exact: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await openStory(page, testInfo, "design-system-learning--confidence");
  const fairlySure = page.getByRole("radio", { name: "Fairly sure" });
  await fairlySure.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Certain" })).toBeChecked();
});
