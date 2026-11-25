import { linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";

export const metadata: Metadata = { title: "Not just yet" };

/**
 * A kind stop for anyone under 13 (SPEC.md section 4.1), as online. Nothing about them was
 * stored: only a short-lived cookie stops an immediate retry.
 */
export default function ProfileStopPage() {
  return (
    <Page title="Eddy is not for you just yet">
      <p className="m-0 mb-4">
        Eddy is made for older students, so we cannot set up a profile for you. Nothing you typed in
        has been kept.
      </p>
      <p className="m-0 mb-4">
        For maths help now, your teacher is a great place to start. Your school may also have
        homework clubs or online practice it already uses.
      </p>
      <p className="m-0 mb-8">
        If something is worrying you, you can talk to Childline for free on 0800 1111, any time.
      </p>
      <p className="m-0">
        <NextLink href="/profiles" className={linkClassName}>
          Back to the profiles
        </NextLink>
      </p>
    </Page>
  );
}
