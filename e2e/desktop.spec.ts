import { expect, test } from "@playwright/test";

import { check } from "./helpers";

/**
 * The desktop app's mode (ADR-0036), on the production server playwright.config.ts starts with
 * EDDY_LOCAL_MODE=1: profiles in place of email sign-in, an optional PIN, the desktop privacy
 * notice, lessons with no typed chat, and the online-only pages switched off. No email is sent and no invite is used.
 */
const LOCAL = "http://localhost:3303";
const PIN = "2468";

function nickname(): string {
  // Unique per test run and browser: every project shares one database.
  return `Sam ${Math.random().toString(36).slice(2, 8)}`;
}

test("an under-13 is stopped kindly and no profile is made", async ({ page }, info) => {
  await page.goto(`${LOCAL}/profiles/new`);
  await expect(page.getByRole("heading", { name: "Make a profile" })).toBeVisible();
  await check(page, "desktop-new-profile", info.project.name);
  const name = nickname();
  await page.getByLabel("What should Eddy call this profile?").fill(name);
  await page.getByLabel("Month").selectOption("6");
  await page.getByLabel("Year").selectOption(String(new Date().getFullYear() - 10));
  await page.getByRole("button", { name: "Make my profile" }).click();
  await expect(page.getByRole("heading", { name: "Eddy is not for you just yet" })).toBeVisible();
  await expect(page.getByText("13")).toHaveCount(0);
  await check(page, "desktop-stop", info.project.name);
  // An immediate retry lands on the same page, and nothing was stored.
  await page.goto(`${LOCAL}/profiles/new`);
  await expect(page).toHaveURL(/\/profiles\/stop$/);
  await page.goto(`${LOCAL}/profiles`);
  await expect(page.getByText(name)).toHaveCount(0);
});

test("a student makes a profile, locks it with a PIN, switches and deletes it", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const name = nickname();

  // The front door is the profile picker: there is no landing page and no sign-in.
  await page.goto(`${LOCAL}/`);
  await expect(page).toHaveURL(/\/profiles$/);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await page.goto(`${LOCAL}/profiles/new`);

  // A bad PIN is caught before anything is made.
  await page.getByLabel("What should Eddy call this profile?").fill(name);
  await page.getByLabel("Month").selectOption("3");
  await page.getByLabel("Year").selectOption(String(new Date().getFullYear() - 15));
  await page.getByLabel("PIN (optional)").fill("12");
  await page.getByRole("button", { name: "Make my profile" }).click();
  await expect(page.getByText("A PIN is 4 to 8 digits")).toBeVisible();
  // The problem is announced, and what was typed is still there (never the PIN).
  // (Next.js keeps an alert region of its own on every page, so ours is found by its words.)
  await expect(
    page.getByRole("alert").filter({ hasText: "Check the answer marked below" }),
  ).toBeVisible();
  await expect(page.getByLabel("What should Eddy call this profile?")).toHaveValue(name);
  await expect(page.getByLabel("Month")).toHaveValue("3");
  await expect(page.getByLabel("PIN (optional)")).toHaveValue("");
  await check(page, "desktop-new-profile-error", info.project.name);

  // The PIN is typed twice, so one slip does not lock a student out of their own profile.
  await page.getByLabel("PIN (optional)").fill(PIN);
  await page.getByLabel("Type the PIN again").fill("2469");
  await page.getByRole("button", { name: "Make my profile" }).click();
  await expect(page.getByText("Type the same PIN in both boxes.")).toBeVisible();
  await page.getByLabel("PIN (optional)").fill(PIN);
  await page.getByLabel("Type the PIN again").fill(PIN);
  await page.getByRole("button", { name: "Make my profile" }).click();

  // The desktop notice, not the online one: nothing leaves the computer.
  await expect(page.getByRole("heading", { name: "Before you start: your privacy" })).toBeVisible();
  await expect(page.getByText("On this computer, and nowhere else.")).toBeVisible();
  await expect(page.getByText("Anthropic")).toHaveCount(0);
  await expect(page.getByText("There is nowhere to type a message.")).toBeVisible();
  await expect(page.getByText("No AI model runs while you use Eddy")).toBeVisible();
  await expect(page.getByText("anyone who uses this computer can open your profile")).toBeVisible();
  await check(page, "desktop-privacy", info.project.name);
  await page.getByRole("button", { name: "I have read this" }).click();
  await expect(page.getByRole("heading", { name: "Set up Eddy" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByText(name)).toBeVisible();

  // Switching goes back to the picker, and the profile now needs its PIN.
  await page.getByRole("button", { name: "Switch profile" }).click();
  await expect(page.getByRole("heading", { name: "Who is learning today?" })).toBeVisible();
  await check(page, "desktop-picker", info.project.name);
  await page.goto(`${LOCAL}/home`);
  await expect(page).toHaveURL(/\/profiles$/);
  // A profile with a PIN is a link to the page that asks for it, not a guess at the PIN.
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name: `Hello, ${name}` })).toBeVisible();
  await page.getByLabel("PIN").fill("0000");
  await page.getByRole("button", { name: "Open my profile" }).click();
  await expect(page.getByText("That PIN is not right")).toBeVisible();
  await check(page, "desktop-pin-error", info.project.name);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Open my profile" }).click();
  await expect(page.getByRole("heading", { name: "Set up Eddy" })).toBeVisible();

  // The online-only pages are off: a visit goes to the start, anything else is a 404.
  for (const path of ["/sign-in", "/join", "/parent", "/check-your-email"]) {
    await page.goto(`${LOCAL}${path}`);
    await expect(page, path).toHaveURL(/\/welcome\/set-up$/);
  }
  expect((await page.request.get(`${LOCAL}/api/auth/session`)).status()).toBe(404);
  expect((await page.request.post(`${LOCAL}/sign-in`, { data: "" })).status()).toBe(404);
  // A request addressed to any other name is refused: a web page cannot pose as Eddy's origin.
  const rebound = await page.request.get(`${LOCAL}/profiles`, {
    headers: { host: "attacker.example:3303" },
  });
  expect(rebound.status()).toBe(400);

  // Eddy cannot pass a report on to anyone here, and says so.
  await page.getByRole("link", { name: "Worried about something?" }).click();
  await expect(page.getByText("it cannot pass a message on to anyone")).toBeVisible();
  await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);
  await check(page, "desktop-concern", info.project.name);
  await page.goto(`${LOCAL}/privacy/full`);
  await expect(page.getByText("Version 0.6.0.")).toBeVisible();
  await check(page, "desktop-privacy-full", info.project.name);

  // A lesson with typed chat off: answers and hints, and nowhere to type a message.
  await page.goto(`${LOCAL}/welcome`);
  await expect(page.getByRole("heading", { name: "Set up Eddy" })).toBeVisible();
  await page.getByLabel("When do you take your exams?").selectOption({ index: 2 });
  await page.getByLabel("Grade 4").check();
  await page.getByRole("radio", { name: "No" }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText(/Question 1 of up to/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "I do not know this yet" }).click();
  await expect(page.getByText("Not this time")).toBeVisible();
  await page.getByRole("link", { name: "Stop for now" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/learn\//);
  await expect(page.getByRole("heading", { name: "Stuck?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask Eddy" })).toHaveCount(0);
  await expect(page.getByLabel("Your message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Give me a hint" })).toBeVisible();
  await check(page, "desktop-lesson", info.project.name);
  const said = page.getByText("Eddy", { exact: true });
  const before = await said.count();
  await page.getByRole("button", { name: "Give me a hint" }).click();
  // The hint itself arrives: one more thing Eddy said, and no error.
  await expect(said).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(page.getByText("That did not work")).toHaveCount(0);
  await expect(page.getByLabel("Your message")).toHaveCount(0);
  await check(page, "desktop-lesson-hint", info.project.name);

  // My data is about a profile: no email address, and none of the online-only sections.
  await page.goto(`${LOCAL}/settings/my-data`);
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Parent links" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Safety records" })).toHaveCount(0);
  await expect(page.getByText("local.invalid")).toHaveCount(0);
  await check(page, "desktop-my-data", info.project.name);

  // Settings has no parent accounts. A student can share a progress summary with whoever is
  // at this computer instead, and nothing is shared until they say so.
  await page.goto(`${LOCAL}/settings`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Parent access" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sharing your progress" })).toBeVisible();
  await expect(page.getByText("Your progress is not shared.")).toBeVisible();
  await check(page, "desktop-settings", info.project.name);
  await page.goto(`${LOCAL}/profiles/parents`);
  await expect(page.getByRole("heading", { name: "For parents and carers" })).toBeVisible();
  await expect(page.getByRole("link", { name })).toHaveCount(0);
  await page.goto(`${LOCAL}/settings`);
  // The card says everything that would be shown, before anything is switched on.
  await expect(page.getByText("the ones you are still working on")).toBeVisible();
  await expect(page.getByText("with how many questions and minutes")).toBeVisible();
  // Sharing shows it without the PIN, so switching on asks for the PIN: an open profile is not
  // enough.
  await page.getByRole("button", { name: "Share my progress" }).click();
  await expect(page.getByText("Type your PIN.")).toBeVisible();
  await expect(page.getByText("Your progress is not shared.")).toBeVisible();
  await page.getByLabel("Your PIN").fill(PIN);
  await page.getByRole("button", { name: "Share my progress" }).click();
  await expect(page.getByText("Your progress is shared on this computer.")).toBeVisible();
  await expect(page.getByText("Nobody has opened it yet.")).toBeVisible();
  // While it is on, every page says so, with the way to see exactly what is shown.
  const note = page.getByRole("note");
  await expect(note).toContainText("shared with people using this computer");
  await check(page, "desktop-settings-sharing", info.project.name);
  await note.getByRole("link", { name: "See what they see" }).click();
  await expect(page.getByRole("heading", { name: "What a parent or carer sees" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topics secured" })).toBeVisible();
  await check(page, "desktop-parent-preview", info.project.name);

  // A parent or carer opens it from the profile list, with no profile open and no PIN.
  await page.getByRole("button", { name: "Switch profile" }).click();
  await page.getByRole("link", { name: "For parents and carers" }).click();
  await expect(page.getByRole("heading", { name: "For parents and carers" })).toBeVisible();
  await check(page, "desktop-parents", info.project.name);
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name: `How ${name} is getting on` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topics secured" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent lessons" })).toBeVisible();
  await check(page, "desktop-parent-progress", info.project.name);
  const shared = page.url();

  // Anyone at the computer can stop it being shown, which is the way out if a PIN is forgotten.
  // The summary is then gone from the list and from its own address.
  await page.getByRole("button", { name: "Stop showing this" }).click();
  await expect(page).toHaveURL(/\/profiles\/parents$/);
  await expect(page.getByRole("link", { name })).toHaveCount(0);
  await page.goto(shared);
  await expect(page).toHaveURL(/\/profiles\/parents$/);

  // The student finds it off, and is told the day it was looked at while it was on.
  await page.goto(`${LOCAL}/profiles`);
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Open my profile" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).getByText(name)).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.goto(`${LOCAL}/settings`);
  await expect(page.getByText("Your progress is not shared.")).toBeVisible();
  // Switching it on again and off again from Settings needs the PIN only to switch on.
  await page.getByLabel("Your PIN").fill(PIN);
  await page.getByRole("button", { name: "Share my progress" }).click();
  await expect(page.getByText(/It was last opened on \d+ \w+\./)).toBeVisible();
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByText("Your progress is not shared.")).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);

  // Deleting the profile takes it off the picker.
  await page.goto(`${LOCAL}/settings`);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete this profile" }).click();
  await expect(page.getByRole("heading", { name: "That profile is deleted" })).toBeVisible();
  await check(page, "desktop-deleted", info.project.name);
  await page.getByRole("link", { name: "Back to the profiles" }).click();
  await expect(page).toHaveURL(/\/profiles$/);
  await expect(page.getByText(name)).toHaveCount(0);
});

test("the profile pages do not exist online", async ({ request }) => {
  for (const path of ["/profiles", "/profiles/new", "/profiles/stop", "/profiles/parents"]) {
    for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
      const response = await request.get(path, { headers });
      expect(response.status(), path).toBe(404);
    }
  }
});
