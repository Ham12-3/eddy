import { expect, test, type Locator, type Page } from "@playwright/test";

import { INVITE, signInLink } from "./helpers";

/**
 * PLAN.md M8 and M10: the core journey by keyboard alone. Sign up, read the notice, set up,
 * answer a diagnostic question with the maths field, and reach today's plan, using only Tab,
 * typing, Space and Enter. Runs once, at desktop width in the light theme.
 */

async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let presses = 0; presses < limit; presses += 1) {
    if (
      await target.evaluate(
        (el) => el === document.activeElement || el.contains(document.activeElement),
      )
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach ${String(target)} with Tab`);
}

test("the core journey works by keyboard alone", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-light", "runs once");
  test.setTimeout(180_000);
  const email = `keys-${Date.now()}@example.test`;

  await page.goto("/");
  await tabTo(page, page.getByRole("link", { name: "Join with an invite code" }));
  await page.keyboard.press("Enter");

  await tabTo(page, page.getByLabel("Invite code"));
  await page.keyboard.type(INVITE);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "A quick question" })).toBeVisible();
  await tabTo(page, page.getByLabel("Month"));
  await page.keyboard.type("March");
  await tabTo(page, page.getByLabel("Year"));
  await page.keyboard.type(String(new Date().getFullYear() - 15));
  await tabTo(page, page.getByRole("button", { name: "Continue" }));
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Your email address" })).toBeVisible();
  await tabTo(page, page.getByLabel("Email address"));
  await page.keyboard.type(email);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // Following the emailed link is a navigation, as a click in an email would be.
  await page.goto(await signInLink(email));
  await tabTo(page, page.getByRole("button", { name: "I have read this" }));
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Set up Eddy" })).toBeVisible();
  await tabTo(page, page.getByLabel("When do you take your exams?"));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await tabTo(page, page.getByLabel("Grade 4"));
  await page.keyboard.press("Space");
  await tabTo(page, page.getByRole("radio", { name: "No" }));
  await page.keyboard.press("Space");
  await tabTo(page, page.getByRole("button", { name: "Save and continue" }));
  await page.keyboard.press("Enter");

  await expect(page.getByText(/Question 1 of up to/)).toBeVisible({ timeout: 30_000 });
  await tabTo(page, page.locator("math-field"));
  await page.keyboard.type("7");
  // A radio group is one Tab stop; the arrow keys choose within it.
  await tabTo(page, page.getByRole("radio", { name: "Guessing" }));
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Unsure" })).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Check my answer" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText(/That is right|Not this time/)).toBeVisible();

  await tabTo(page, page.getByRole("link", { name: "Stop for now" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});
