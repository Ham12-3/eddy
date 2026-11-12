import type { Metadata } from "next";

import { Page } from "@/components/Page";

export const metadata: Metadata = { title: "Not just yet" };

/**
 * A kind stop for anyone under 13 (SPEC.md section 4.1). We stored nothing about them: only a
 * short-lived cookie stops an immediate retry.
 */
export default function StopPage() {
  return (
    <Page title="Eddy is not for you just yet">
      <p className="m-0 mb-4">
        Eddy is made for older students, so we cannot set up an account for you today. We have not
        kept anything you typed in.
      </p>
      <p className="m-0 mb-4">
        For maths help now, your teacher is a great place to start. Your school may also have
        homework clubs or online practice it already uses.
      </p>
      <p className="m-0">
        If something is worrying you, you can talk to Childline for free on 0800 1111, any time.
      </p>
    </Page>
  );
}
