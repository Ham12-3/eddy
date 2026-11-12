import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { check, newStudent, signInLink, waitForMail } from "./helpers";

/**
 * PLAN.md M9: linking (a parent with the student's code, the student accepting), the parent's
 * dashboard and the student's preview, unlinking with a notice, download my data, and deletion
 * through to erasure.
 */

const E2E_DATABASE_URL = "postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy_e2e";

function pythonInE2E(code: string): string {
  return execFileSync("uv", ["run", "--package", "eddy-api", "python", "-c", code], {
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      RUNTIME_DATABASE_URL: "postgresql+psycopg://eddy_app:eddy_app@127.0.0.1:5442/eddy_e2e",
    },
    encoding: "utf8",
  }).trim();
}

test("a parent links with a code, the student accepts, either can end it", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const stamp = `${info.project.name}-${Date.now()}`;
  const studentEmail = `student-${stamp}@example.test`;
  const parentEmail = `parent-${stamp}@example.test`;

  await newStudent(page, studentEmail);
  await page.goto("/settings");
  await check(page, "settings-parent-access", info.project.name);
  await page.getByRole("button", { name: "Make a code for a parent" }).click();
  const codeText = await page.locator("p.font-mono").textContent();
  const code = (codeText ?? "").trim();
  expect(code).toMatch(/^[A-Z2-9]{10}$/);

  const parentContext = await browser.newContext();
  const parent = await parentContext.newPage();
  await parent.goto(`/parent/join?code=${code}`);
  await expect(parent.getByRole("heading", { name: "See your child's progress" })).toBeVisible();
  await check(parent, "parent-join", info.project.name);
  await parent.getByLabel("Your email address").fill(parentEmail);
  await parent.getByLabel("I am this student's parent or carer, and I am 18 or over").check();
  await parent.getByRole("button", { name: "Send my link" }).click();
  await expect(parent.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await parent.goto(await signInLink(parentEmail));
  await expect(parent.getByRole("heading", { name: "Waiting for your child" })).toBeVisible();
  await check(parent, "parent-waiting", info.project.name);

  await waitForMail(studentEmail, "a parent asked");
  await page.reload();
  await expect(page.getByText(`${parentEmail} asked to see your progress`)).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText(`${parentEmail} can see your progress.`)).toBeVisible();
  await page.goto("/home");
  await expect(page.getByRole("note")).toContainText("Your parent can see your progress");
  await page.getByRole("link", { name: "See what they see" }).click();
  await expect(page.getByRole("heading", { name: "What my parent sees" })).toBeVisible();
  await check(page, "parent-preview", info.project.name);

  await waitForMail(parentEmail, "your link was accepted");
  await parent.goto("/parent");
  await parent.getByRole("link", { name: "See progress" }).click();
  await expect(parent.getByRole("heading", { name: "Topics secured" })).toBeVisible();
  await expect(parent.getByText("Your answers")).toHaveCount(0);
  await check(parent, "parent-dashboard", info.project.name);
  await parent.getByRole("button", { name: "Stop seeing their progress" }).click();
  await expect(parent.getByRole("heading", { name: "No linked children" })).toBeVisible();
  await waitForMail(studentEmail, "a parent link has ended");
  await page.goto("/home");
  await expect(page.getByRole("note")).toHaveCount(0);
  await parentContext.close();
});

test("a student downloads their data, then deletes their account", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `data-${info.project.name}-${Date.now()}@example.test`;
  await newStudent(page, email);

  await page.goto("/settings");
  await page.getByRole("link", { name: "Download my data" }).click();
  await expect(page.getByRole("heading", { name: "My data" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await check(page, "my-data", info.project.name);
  const download = await page.request.get("/settings/my-data/download");
  expect(download.headers()["content-disposition"]).toContain("eddy-my-data.json");
  const data = (await download.json()) as { account: { email: string } };
  expect(data.account.email).toBe(email);

  await page.goto("/settings");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("heading", { name: "Your account is closed" })).toBeVisible();

  // The erasure job completes the request: the account is gone.
  pythonInE2E(
    "from eddy_api.jobs import erasures; from eddy_api.db.session import session_factory; " +
      "s = session_factory()(); print(erasures(s))",
  );
  const left = pythonInE2E(
    "from sqlalchemy import create_engine, text; import os; " +
      "e = create_engine(os.environ['DATABASE_URL']); c = e.connect(); " +
      `print(c.execute(text("SELECT count(*) FROM users WHERE email = :e"), {"e": "${email}"}).scalar())`,
  );
  expect(left).toBe("0");
});
