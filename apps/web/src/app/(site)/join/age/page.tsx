import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Page } from "@/components/Page";
import { readJoin, stoppedByAge } from "@/lib/join";

import { AgeForm } from "../JoinForms";

export const metadata: Metadata = { title: "Your age" };

export default async function AgePage() {
  if (await stoppedByAge()) redirect("/join/stop");
  if (!(await readJoin())) redirect("/join");
  return (
    <Page
      title="A quick question"
      lead="We ask everyone their month and year of birth. We never ask for the day."
    >
      <AgeForm thisYear={new Date().getFullYear()} />
    </Page>
  );
}
