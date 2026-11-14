import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

export const INVITE = "E2E-JOURNEY";
export const MAILPIT = "http://127.0.0.1:8025";

export async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

export async function check(page: Page, name: string, project: string) {
  await expectNoBlockingViolations(page);
  mkdirSync("e2e-artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `e2e-artifacts/screenshots/${name}-${project}.png`,
    fullPage: true,
  });
}

interface MailSummary {
  ID: string;
  Subject: string;
}

async function messagesTo(email: string): Promise<MailSummary[]> {
  const search = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  );
  return ((await search.json()) as { messages: MailSummary[] }).messages;
}

/** Waits for an email to `email` whose subject contains `subject`. */
export async function waitForMail(email: string, subject: string): Promise<MailSummary> {
  for (let tries = 0; tries < 40; tries += 1) {
    const found = (await messagesTo(email)).find((m) => m.Subject.includes(subject));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email "${subject}" for ${email}`);
}

export async function signInLink(email: string): Promise<string> {
  const message = await waitForMail(email, "sign-in link");
  const body = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
    Text: string;
  };
  const link = /http\S+/.exec(body.Text)?.[0];
  if (!link) throw new Error(`No link in the email to ${email}`);
  return link;
}

/** Signs a new student up and through onboarding, leaving them on the diagnostic. */
export async function newStudent(page: Page, email: string) {
  await page.goto("/join");
  await page.getByLabel("Invite code").fill(INVITE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Month").selectOption("3");
  await page.getByLabel("Year").selectOption(String(new Date().getFullYear() - 15));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send my link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await signInLink(email));
  await page.getByRole("button", { name: "I have read this" }).click();
  await expect(page.getByRole("heading", { name: "Set up Eddy" })).toBeVisible();
  await page.getByLabel("When do you take your exams?").selectOption({ index: 2 });
  await page.getByLabel("Grade 4").check();
  await page.getByRole("radio", { name: "No" }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible({
    timeout: 30_000,
  });
}
