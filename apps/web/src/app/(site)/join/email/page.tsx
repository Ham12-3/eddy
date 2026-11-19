import type { Metadata } from "next";
import NextLink from "next/link";
import { redirect } from "next/navigation";

import { linkClassName } from "@eddy/ui";

import { Page } from "@/components/Page";
import { readJoin } from "@/lib/join";

import { EmailForm } from "../JoinForms";

export const metadata: Metadata = { title: "Your email" };

export default async function EmailPage() {
  const join = await readJoin();
  if (!join?.birthYear) redirect("/join");
  return (
    <Page title="Your email address" lead="Last step. We will email you a link to sign in.">
      <EmailForm />
      <p className="mt-8 mb-0 text-caption text-ink-muted">
        We use your email only to sign you in and to reply if you contact us. Read the{" "}
        <NextLink href="/privacy" className={linkClassName}>
          privacy notice
        </NextLink>{" "}
        for everything we keep.
      </p>
    </Page>
  );
}
