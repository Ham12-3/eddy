import { buttonClassName, Feedback, linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { apiClientFor } from "@/lib/api";
import { LOCAL_CALLER } from "@/lib/local-profile";

import { ProfileList, type PickerProfile } from "./ProfileForms";

export const metadata: Metadata = { title: "Choose a profile" };
// The profiles on this computer, as they are now.
export const dynamic = "force-dynamic";

async function profiles(): Promise<PickerProfile[] | null> {
  try {
    const api = await apiClientFor(LOCAL_CALLER);
    const { data } = await api.GET("/v1/local/profiles", { signal: AbortSignal.timeout(15_000) });
    return data ?? null;
  } catch {
    return null;
  }
}

/** The desktop app's front door (ADR-0036): pick your profile, or make one. */
export default async function ProfilesPage() {
  const list = await profiles();
  if (list === null) {
    return (
      <Page title="Eddy is still starting">
        {/* Tries again by itself every few seconds, with or without JavaScript. */}
        <meta httpEquiv="refresh" content="4" />
        <Feedback kind="info" title="Not ready yet">
          Eddy could not read the profiles on this computer. It may still be starting up, and this
          page will try again in a few seconds.
        </Feedback>
        <p className="m-0 mt-6">
          <NextLink href="/profiles" className={buttonClassName("secondary")}>
            Try again
          </NextLink>
        </p>
      </Page>
    );
  }
  if (list.length === 0) {
    return (
      <Page
        title="Welcome to Eddy"
        lead="A GCSE Maths tutor that explains your own mistakes with short animations."
      >
        <p className="m-0 mb-4">
          Eddy runs on this computer and needs no internet. Your work stays here: nothing is sent
          anywhere.
        </p>
        <p className="m-0 mb-8">There are no profiles on this computer yet. Make yours to start.</p>
        <NextLink href="/profiles/new" className={buttonClassName("accent")}>
          Make a profile
        </NextLink>
      </Page>
    );
  }
  return (
    <Page title="Who is learning today?" lead="Choose your profile.">
      <ProfileList profiles={list} />
      <p className="m-0 mt-8">
        <NextLink href="/profiles/new" className={buttonClassName("quiet")}>
          Add a profile
        </NextLink>
      </p>
      {/* A parent or carer has no profile: this is their way to a summary a student shares. */}
      <p className="m-0 mt-4">
        <NextLink
          href="/profiles/parents"
          className={`${linkClassName} inline-flex min-h-11 items-center`}
        >
          For parents and carers
        </NextLink>
      </p>
    </Page>
  );
}
