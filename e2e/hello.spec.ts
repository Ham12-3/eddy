import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("hello page reaches the API with a verified service token", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Eddy" })).toBeVisible();
  await expect(page.getByTestId("web-status")).toHaveText("Running");
  await expect(page.getByTestId("api-status")).toHaveText("Connected");
  await expect(page.getByText("system:hello-page", { exact: true })).toBeVisible();
});

test("hello page has no serious or critical accessibility violations", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("api-status")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

  await page.screenshot({
    path: `e2e-artifacts/screenshots/hello-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("responses carry the baseline security headers", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("geolocation=()");
  expect(headers["x-powered-by"]).toBeUndefined();
});
