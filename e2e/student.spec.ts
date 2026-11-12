import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The student journey (PLAN.md M8): sign-up with an invite, the age gate, the privacy notice,
 * set-up, the diagnostic, today's plan, a lesson, review, progress, settings and a concern.
 * The tutor runs without Claude here (templated messages), and sign-in links come from Mailpit.
 */

const INVITE = "E2E-JOURNEY";
const MAILPIT = "http://127.0.0.1:8025";

async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function screenshot(page: Page, name: string, project: string) {
  mkdirSync("e2e-artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `e2e-artifacts/screenshots/${name}-${project}.png`,
    fullPage: true,
  });
}

async function check(page: Page, name: string, project: string) {
  await expectNoBlockingViolations(page);
  await screenshot(page, name, project);
}

async function signInLink(email: string): Promise<string> {
  for (let tries = 0; tries < 40; tries += 1) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    );
    const found = (await search.json()) as { messages: Array<{ ID: string }> };
    const first = found.messages[0];
    if (first) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${first.ID}`)).json()) as {
        Text: string;
      };
      const link = /http\S+/.exec(message.Text)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in email for ${email}`);
}

test.describe.configure({ mode: "serial" });

test("an under-13 is stopped kindly and nothing is kept", async ({ page }, info) => {
  await page.goto("/join");
  await page.getByLabel("Invite code").fill(INVITE);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "A quick question" })).toBeVisible();
  await check(page, "join-age", info.project.name);
  const year = String(new Date().getFullYear() - 10);
  await page.getByLabel("Month").selectOption("6");
  await page.getByLabel("Year").selectOption(year);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Eddy is not for you just yet" })).toBeVisible();
  await expect(page.getByText("13")).toHaveCount(0);
  await check(page, "join-stop", info.project.name);
  // An immediate retry lands on the same page.
  await page.goto("/join/age");
  await expect(page).toHaveURL(/\/join\/stop$/);
});

test("a student signs up, sets up, starts the diagnostic and learns", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-${info.project.name}-${Date.now()}@example.test`;

  await page.goto("/");
  await check(page, "landing", info.project.name);
  await page.getByRole("link", { name: "Join with an invite code" }).click();
  await page.getByLabel("Invite code").fill("nope");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That code does not work")).toBeVisible();
  await check(page, "join-invite-error", info.project.name);
  await page.getByLabel("Invite code").fill(INVITE);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Month").selectOption("3");
  await page.getByLabel("Year").selectOption(String(new Date().getFullYear() - 15));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your email address" })).toBeVisible();
  await check(page, "join-email", info.project.name);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send my link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await check(page, "check-your-email", info.project.name);

  await page.goto(await signInLink(email));
  await expect(page.getByRole("heading", { name: "Before you start: your privacy" })).toBeVisible();
  await check(page, "welcome-privacy", info.project.name);
  await page.getByRole("button", { name: "I have read this" }).click();

  await expect(page.getByRole("heading", { name: "Set up Eddy" })).toBeVisible();
  await check(page, "welcome-set-up", info.project.name);
  await page.getByLabel("When do you take your exams?").selectOption({ index: 2 });
  await page.getByLabel("Grade 4").check();
  await page.getByRole("radio", { name: "No" }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Question 1 of up to/)).toBeVisible({ timeout: 30_000 });
  await check(page, "diagnostic", info.project.name);
  await page.getByRole("button", { name: "I do not know this yet" }).click();
  await expect(page.getByText("Not this time")).toBeVisible();
  await check(page, "diagnostic-reveal", info.project.name);
  await page.getByRole("link", { name: "Stop for now" }).click();

  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish your first questions" })).toBeVisible();
  await check(page, "home", info.project.name);
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page).toHaveURL(/\/learn\//);
  await expect(page.getByRole("heading", { name: "Ask Eddy" })).toBeVisible();
  await check(page, "lesson", info.project.name);
  // Work through the lesson's opening until a question waits for an answer.
  for (let step = 0; step < 6; step += 1) {
    if (await page.locator("math-field").isVisible()) break;
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Eddy is writing")).toHaveCount(0, { timeout: 30_000 });
  }
  await expect(page.locator("math-field")).toBeVisible();
  await page.locator("math-field").evaluate((element: HTMLElement & { value: string }) => {
    element.value = "123456";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByRole("group", { name: "How sure are you?" })).toBeVisible();
  await page.getByText("Unsure").click();
  await page.getByRole("button", { name: "Mark it" }).click();
  await expect(page.getByText("Not quite", { exact: true })).toBeVisible({ timeout: 30_000 });
  await check(page, "lesson-marked", info.project.name);

  await page.getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "No reviews due" })).toBeVisible();
  await check(page, "review", info.project.name);

  await page.getByRole("link", { name: "Progress" }).click();
  await expect(page.getByRole("heading", { name: "Progress", exact: true })).toBeVisible();
  await check(page, "progress", info.project.name);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
  await check(page, "settings", info.project.name);

  await page.getByRole("link", { name: "Report a concern" }).first().click();
  await page.getByLabel("Something Eddy said or showed").check();
  await page.getByLabel("What happened?").fill("A test report from the end-to-end suite.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thank you, we have your report")).toBeVisible();
  await check(page, "concern", info.project.name);

  // Delete the account: it stops working at once.
  await page.goto("/settings");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("heading", { name: "Your account is closed" })).toBeVisible();
  await page.goto("/home");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the public pages pass axe", async ({ page }, info) => {
  for (const [path, name] of [
    ["/sign-in", "sign-in"],
    ["/privacy", "privacy"],
    ["/privacy/full", "privacy-full"],
    ["/concern", "concern-signed-out"],
    ["/sign-in/problem", "sign-in-problem"],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await check(page, name, info.project.name);
  }
});
