import type { Metadata } from "next";

import { Page } from "@/components/Page";
import { ChildPrivacyNotice, DraftNote } from "@/content/privacy";
import { LocalChildPrivacyNotice, LocalDraftNote } from "@/content/privacy-local";
import { isLocalMode } from "@/lib/local-mode";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <Page title="Your privacy" lead="What Eddy keeps about you, why, and what you can do about it.">
      {isLocalMode() ? <LocalDraftNote /> : <DraftNote />}
      {isLocalMode() ? <LocalChildPrivacyNotice /> : <ChildPrivacyNotice />}
    </Page>
  );
}
