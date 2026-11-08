import AxeBuilder from "@axe-core/playwright";
import { TEMPLATES } from "@eddy/scenes/registry";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * The scene gallery (PLAN.md M5): every default scene plays, steps from the keyboard, has captions,
 * a transcript and a static diagram, and passes axe at every viewport and mode. Static and DOM
 * checks for every keyframe run separately in `pnpm scenes:check`.
 */

async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `e2e-artifacts/screenshots/${name}-${testInfo.project.name}.png`,
    fullPage: true,
  });
}

test("the scene gallery lists every default scene", async ({ page }, testInfo) => {
  await page.goto("/admin/scenes");
  await expect(page.getByRole("heading", { level: 1, name: "Scenes" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(TEMPLATES.length);
  await expectNoBlockingViolations(page);
  await screenshot(page, testInfo, "admin-scenes");
});

test("an unknown scene is a 404", async ({ request }) => {
  expect((await request.get("/admin/scenes/nope")).status()).toBe(404);
  expect((await request.get("/admin/scenes/bar_model.nope")).status()).toBe(404);
});

for (const template of TEMPLATES) {
  test(`${template.key}: captions, transcript, keyboard and diagram`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/admin/scenes/${template.key}`);
    const player = page.getByRole("region", { name: template.title, exact: true });
    const controls = player.getByRole("group", { name: "Explanation controls" });
    const steps = await player
      .getByText(/^Step 1 of \d$/)
      .first()
      .textContent();
    const total = Number(steps?.match(/of (\d)/)?.[1]);

    // Never autoplays: it opens paused on the first beat, with its caption showing.
    await expect(controls.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Captions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(player.getByRole("paragraph").last()).not.toBeEmpty();

    // Keyboard: the right arrow steps forward, the left arrow steps back, Space plays and pauses.
    const stage = player.getByRole("group", { name: new RegExp(`^${template.title}\\. Step`) });
    await stage.focus();
    await page.keyboard.press("ArrowRight");
    await expect(controls.getByText(`Step 2 of ${total}`)).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(controls.getByText(`Step 1 of ${total}`)).toBeVisible();
    await page.keyboard.press("Space");
    await expect(controls.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(controls.getByRole("button", { name: "Play", exact: true })).toBeVisible();

    // The transcript lists every beat's narration.
    await controls.getByRole("button", { name: "Transcript" }).click();
    await expect(
      player.getByRole("region", { name: "Transcript" }).getByRole("listitem"),
    ).toHaveCount(total);

    // The static diagram shows every beat with its narration.
    const diagram = page.getByRole("region", { name: `${template.title}, step by step` });
    await expect(diagram.getByRole("figure")).toHaveCount(total);

    await expectNoBlockingViolations(page);
    await screenshot(page, testInfo, `scene-${template.key}`);
  });
}
