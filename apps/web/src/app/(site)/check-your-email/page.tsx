import { linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { LINK_MINUTES } from "@/auth";
import { Page } from "@/components/Page";

export const metadata: Metadata = { title: "Check your email" };

/** The same page whether or not a link was sent, so nobody can probe for accounts. */
export default function CheckYourEmailPage() {
  return (
    <Page title="Check your email">
      <p className="m-0 mb-4">
        If that address can sign in to Eddy, a link is on its way. It works once, within{" "}
        {LINK_MINUTES} minutes.
      </p>
      <p className="m-0 mb-4">
        Nothing yet? Check your junk or spam folder, and make sure the address was typed correctly.
      </p>
      <p className="m-0">
        <NextLink href="/sign-in" className={linkClassName}>
          Send a new link
        </NextLink>
      </p>
    </Page>
  );
}
