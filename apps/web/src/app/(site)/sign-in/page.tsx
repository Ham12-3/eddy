import { linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";
import { redirect } from "next/navigation";

import { Page } from "@/components/Page";
import { signedInStudent } from "@/lib/session";

import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await signedInStudent()) redirect("/welcome");
  return (
    <Page title="Sign in" lead="We will email you a link. No password to remember.">
      <SignInForm />
      <p className="mt-8 mb-0">
        New to Eddy?{" "}
        <NextLink href="/join" className={linkClassName}>
          Join with an invite code
        </NextLink>
        .
      </p>
    </Page>
  );
}
