import type { Metadata } from "next";

import { Page } from "@/components/Page";

export const metadata: Metadata = { title: "Account deleted" };

export default function DeletedPage() {
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
