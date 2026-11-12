import type { Metadata } from "next";

import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

import { SetUpForm, type SeriesOption } from "./SetUpForm";

export const metadata: Metadata = { title: "Set up" };

/** The next four GCSE sittings: summer for everyone, November for resits. */
function nextSittings(today: Date): SeriesOption[] {
  const options: SeriesOption[] = [];
  for (let year = today.getFullYear(); options.length < 4; year += 1) {
    if (new Date(year, 6, 1) > today) {
      options.push({ value: `${year}-summer`, label: `Summer ${year}` });
    }
    if (options.length < 4 && new Date(year, 11, 1) > today) {
      options.push({ value: `${year}-november`, label: `November ${year} (resits)` });
    }
  }
  return options;
}

export default async function SetUpPage() {
  const { me } = await requireStudent({ onboarding: true });
  return (
    <Page
      title="Set up Eddy"
      lead="A few questions so Eddy teaches the right things. You can change how Eddy looks and sounds later in Settings."
    >
      <SetUpForm me={me} series={nextSittings(new Date())} />
    </Page>
  );
}
