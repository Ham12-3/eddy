import { buttonClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { isLocalMode } from "@/lib/local-mode";

export function generateMetadata(): Metadata {
  return { title: isLocalMode() ? "Profile deleted" : "Account deleted" };
}

export default function DeletedPage() {
  if (isLocalMode()) {
    return (
      <Page title="That profile is deleted">
        <p className="m-0 mb-4">
          The profile no longer works and is gone from the list on this computer. Eddy will erase
          its answers, progress and settings. The privacy notice says what stays.
        </p>
        <p className="m-0 mb-8">Good luck with your exams.</p>
        <NextLink href="/profiles" className={buttonClassName("secondary")}>
          Back to the profiles
        </NextLink>
      </Page>
    );
  }
  return (
    <Page title="Your account is closed">
      <p className="m-0 mb-4">
        You are signed out, and your account no longer works. Everything Eddy holds about you will
        be erased within 30 days.
      </p>
      <p className="m-0">Good luck with your exams.</p>
    </Page>
  );
}
