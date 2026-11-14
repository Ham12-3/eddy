import type { Metadata } from "next";

import { Page } from "@/components/Page";
import { ChildPrivacyNotice, DraftNote } from "@/content/privacy";
import { requireStudent } from "@/lib/session";

import { AcknowledgeForm } from "./AcknowledgeForm";

export const metadata: Metadata = { title: "Your privacy" };

export default async function WelcomePrivacyPage() {
  await requireStudent({ onboarding: true });
  return (
    <Page
      title="Before you start: your privacy"
      lead="Here is what Eddy keeps about you and why. It takes about three minutes to read."
    >
      <DraftNote />
      <ChildPrivacyNotice />
      <AcknowledgeForm />
    </Page>
  );
}
