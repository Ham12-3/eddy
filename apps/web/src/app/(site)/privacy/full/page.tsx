import { linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { DraftNote, FullPrivacyNotice } from "@/content/privacy";
import { PRIVACY_NOTICE_VERSION } from "@/lib/notices";

export const metadata: Metadata = { title: "Full privacy notice" };

export default function FullPrivacyPage() {
  return (
    <Page title="Full privacy notice" lead={`Version ${PRIVACY_NOTICE_VERSION}.`}>
      <DraftNote />
      <FullPrivacyNotice />
      <p className="m-0">
        <NextLink href="/privacy" className={linkClassName}>
          Back to the short version
        </NextLink>
      </p>
    </Page>
  );
}
