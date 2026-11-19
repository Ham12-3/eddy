import { Card, ErrorState, linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { SubmitButton } from "@/components/forms";
import { Page } from "@/components/Page";
import { PRIVACY_NOTICE_VERSION } from "@/lib/notices";
import { requireParent } from "@/lib/session";

import { acknowledgeParentNotice } from "../actions";
import { ParentDeleteForm } from "../ParentForms";

export const metadata: Metadata = { title: "Your account" };

/** A parent's own account (ADR-0034): the privacy notice, their data, deleting the account. */
export default async function ParentAccountPage() {
  const { api } = await requireParent();
  const { data: me } = await api.GET("/v1/parent/me");
  if (!me) {
    return (
      <Page title="Your account">
        <ErrorState title="Your account could not be loaded" headingLevel={2}>
          <p className="m-0">Try again in a moment.</p>
        </ErrorState>
      </Page>
    );
  }
  const current = me.notice_version === PRIVACY_NOTICE_VERSION;
  return (
    <Page title="Your account" lead={`Signed in as ${me.email}.`}>
      <div className="flex flex-col gap-8">
        <Card as="section" aria-labelledby="privacy" className="flex flex-col gap-3">
          <h2 id="privacy" className="m-0 text-h3">
            Privacy
          </h2>
          <p className="m-0">
            Read the{" "}
            <NextLink href="/privacy/full" className={linkClassName}>
              privacy notice
            </NextLink>{" "}
            for what Eddy keeps about you and your child, and why.
          </p>
          {current ? (
            <p className="m-0 text-ink-muted">You have read version {PRIVACY_NOTICE_VERSION}.</p>
          ) : (
            <form action={acknowledgeParentNotice}>
              <SubmitButton variant="secondary">I have read the privacy notice</SubmitButton>
            </form>
          )}
        </Card>
        <Card as="section" aria-labelledby="data" className="flex flex-col gap-3">
          <h2 id="data" className="m-0 text-h3">
            Your data
          </h2>
          <p className="m-0">Download everything Eddy holds about you, as a file.</p>
          <p className="m-0">
            <a href="/parent/account/download" className={linkClassName}>
              Download my data
            </a>
          </p>
        </Card>
        <Card as="section" aria-labelledby="delete" className="flex flex-col gap-3">
          <h2 id="delete" className="m-0 text-h3">
            Delete your account
          </h2>
          <ParentDeleteForm />
        </Card>
      </div>
    </Page>
  );
}
