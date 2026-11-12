import { buttonClassName, Card } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

import { ParentAccess } from "./ParentAccess";
import { DeleteForm, PreferencesForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Settings" };

/** Display choices, parent access, and the data rights two clicks from anywhere (SPEC.md 4.5). */
export default async function SettingsPage() {
  // Reachable before onboarding is finished: deleting an account never waits on a notice.
  const { api, me } = await requireStudent({ onboarding: true });
  const { data: links } = await api.GET("/v1/me/parent-links");
  const joinUrl = `${process.env.AUTH_URL ?? ""}/parent/join`;
  return (
    <Page title="Settings">
      <div className="flex flex-col gap-8">
        <Card as="section" aria-labelledby="display" className="flex flex-col gap-4">
          <h2 id="display" className="m-0 text-h3">
            How Eddy looks and sounds
          </h2>
          <PreferencesForm preferences={me.preferences} />
        </Card>
        <Card as="section" aria-labelledby="parent-access" className="flex flex-col gap-4">
          <h2 id="parent-access" className="m-0 text-h3">
            Parent access
          </h2>
          {links ? (
            <ParentAccess links={links} joinUrl={joinUrl} />
          ) : (
            <p className="m-0">Parent access could not be loaded. Try again in a moment.</p>
          )}
        </Card>
        <Card as="section" aria-labelledby="your-data" className="flex flex-col gap-4">
          <h2 id="your-data" className="m-0 text-h3">
            Your data
          </h2>
          <p className="m-0">See everything Eddy holds about you, and download it as a file.</p>
          <div>
            <NextLink href="/settings/my-data" className={buttonClassName("secondary")}>
              Download my data
            </NextLink>
          </div>
        </Card>
        <Card as="section" aria-labelledby="delete" className="flex flex-col gap-4">
          <h2 id="delete" className="m-0 text-h3">
            Delete your account
          </h2>
          <DeleteForm />
        </Card>
      </div>
    </Page>
  );
}
