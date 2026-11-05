import { readFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";

interface IndexEntry {
  id: string;
  type: "story" | "docs";
  title: string;
  name: string;
}

/** Every story in the static Storybook build (built by `pnpm e2e:storybook` before the tests). */
export function listStories(): IndexEntry[] {
  const index = JSON.parse(readFileSync("packages/ui/storybook-static/index.json", "utf8")) as {
    entries: Record<string, IndexEntry>;
  };
  return Object.values(index.entries).filter((entry) => entry.type === "story");
}

/** Opens a story in the preview iframe with the project's mode, and waits until it has settled. */
export async function openStory(page: Page, testInfo: TestInfo, id: string): Promise<void> {
  const globals = (testInfo.project.metadata as { globals?: string }).globals;
  const query = new URLSearchParams({ id, viewMode: "story" });
  if (globals) query.set("globals", globals);
  await page.goto(`/iframe.html?${query.toString()}`);
  await page.locator("#storybook-root > *").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const mathFields = page.locator("math-field");
  for (let i = 0; i < (await mathFields.count()); i++) {
    await mathFields.nth(i).and(page.locator("[data-ready='true']")).waitFor();
  }
}
