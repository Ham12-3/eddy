import { linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";
import { redirect } from "next/navigation";

import { Page } from "@/components/Page";
import { stoppedByAge } from "@/lib/join";

import { NewProfileForm } from "../ProfileForms";

export const metadata: Metadata = { title: "Make a profile" };

export default async function NewProfilePage() {
  if (await stoppedByAge()) redirect("/profiles/stop");
  return (
    <Page
      title="Make a profile"
      lead="We ask everyone their month and year of birth. We never ask for the day."
    >
      <NewProfileForm thisYear={new Date().getFullYear()} />
      <p className="m-0 mt-8">
        <NextLink href="/profiles" className={linkClassName}>
          Back to the profiles
        </NextLink>
      </p>
    </Page>
  );
}
