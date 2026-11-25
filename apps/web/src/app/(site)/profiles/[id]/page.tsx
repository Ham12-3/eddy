import { linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";
import { redirect } from "next/navigation";

import { Page } from "@/components/Page";
import { apiClientFor } from "@/lib/api";
import { LOCAL_CALLER } from "@/lib/local-profile";

import { PinForm } from "../ProfileForms";

export const metadata: Metadata = { title: "Enter your PIN" };
export const dynamic = "force-dynamic";

/** The PIN for one profile. Anything that is not a profile on this computer goes back. */
export default async function ProfilePinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await apiClientFor(LOCAL_CALLER);
  const { data } = await api.GET("/v1/local/profiles");
  const profile = data?.find((candidate) => candidate.id === id);
  if (!profile) redirect("/profiles");
  return (
    <Page title={`Hello, ${profile.name}`} lead="Enter your PIN to open your profile.">
      <PinForm id={profile.id} />
      <p className="m-0 mt-6 text-ink-muted">
        Forgotten your PIN? Eddy cannot recover it. You can make a new profile with a different
        name, but the work in this one stays locked.
      </p>
      <p className="m-0 mt-8">
        <NextLink href="/profiles" className={linkClassName}>
          Not you? Choose another profile
        </NextLink>
      </p>
    </Page>
  );
}
