import { buttonClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";

export const metadata: Metadata = { title: "That link did not work" };

/** Auth.js sends every sign-in problem here: an old or used link, or a sign-up that lapsed. */
export default function SignInProblemPage() {
  return (
    <Page title="That link did not work">
      <p className="m-0 mb-4">
        Sign-in links work once, and only for a short time. This one may have been used already or
        be too old.
      </p>
      <p className="m-0 mb-8">Ask for a new link and use the newest email.</p>
      <NextLink href="/sign-in" className={buttonClassName("accent")}>
        Send a new link
      </NextLink>
    </Page>
  );
}
