import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

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

test("the curriculum browser lists topics and every subject content statement", async ({
  page,
}, testInfo) => {
  await page.goto("/admin/curriculum");

  await expect(page.getByRole("heading", { level: 1, name: "Curriculum" })).toBeVisible();
  const topics = page.getByRole("region", { name: "Topics" }).getByRole("listitem");
  await expect(topics).toHaveCount(13);
  await expect(page.getByRole("heading", { level: 3, name: "Number", exact: true })).toBeVisible();
  // Every node row has a link to its page: 97 statements from N1 to S6.
  await expect(page.getByRole("region", { name: "Subject content" }).getByRole("row")).toHaveCount(
    97 + 6,
  );

  await expectNoBlockingViolations(page);
  await screenshot(page, testInfo, "admin-curriculum");
});

test("a node page shows its prerequisites and misconceptions", async ({ page }, testInfo) => {
  await page.goto("/admin/curriculum/A9");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("A9");
  await expect(page.getByRole("link", { name: "A8", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "A10", exact: true })).toBeVisible();
  const misconceptions = page.getByRole("region", { name: /Misconceptions/ });
  await expect(misconceptions.getByRole("article").first()).toBeVisible();

  await expectNoBlockingViolations(page);
  await screenshot(page, testInfo, "admin-node");
});

test("an unknown node is a 404", async ({ request }) => {
  expect((await request.get("/admin/curriculum/Z9")).status()).toBe(404);
  expect((await request.get("/admin/curriculum/N99")).status()).toBe(404);
});

test.describe("without the preview flag", () => {
  // The second production server from playwright.config.ts, started without EDDY_ADMIN_PREVIEW.
  const gated = "http://127.0.0.1:3302";

  for (const path of ["/admin", "/admin/curriculum", "/admin/curriculum/N1"]) {
    test(`${path} is a 404 that renders nothing`, async ({ request }) => {
      const variants: Record<string, string>[] = [{}, { RSC: "1" }];
      for (const headers of variants) {
        const response = await request.get(`${gated}${path}`, { headers });
        expect(response.status(), JSON.stringify(headers)).toBe(404);
        const body = await response.text();
        expect(body).not.toContain("Order and compare numbers");
        expect(body).not.toContain("Admin preview");
      }
    });
  }
});
