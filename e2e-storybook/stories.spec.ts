import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { listStories, openStory } from "./story";

for (const story of listStories()) {
  test(`${story.title} / ${story.name}: no serious or critical axe violations`, async ({
    page,
  }, testInfo) => {
    await openStory(page, testInfo, story.id);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        targets: nodes.map((node) => node.target),
      }));
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    await page.screenshot({
      path: `e2e-artifacts/storybook/${testInfo.project.name}/${story.id}.png`,
      fullPage: true,
    });
  });
}
