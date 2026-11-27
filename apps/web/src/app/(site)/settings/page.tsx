import { buttonClassName, Card } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { isLocalMode } from "@/lib/local-mode";
import { requireStudent } from "@/lib/session";

import { ParentAccess } from "./ParentAccess";
import { ProgressSharing } from "./ProgressSharing";
import { DeleteForm, PreferencesForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Settings" };

/**
 * Display choices, parent access (in the desktop app, sharing progress on this computer), and the
 * data rights two clicks from anywhere (SPEC.md 4.5).
 */
export default async function SettingsPage() {
  // Reachable before onboarding is finished: deleting an account never waits on a notice.
  const { api, me } = await requireStudent({ onboarding: true });
  // The desktop app has no parent accounts: nothing leaves this computer (ADR-0036). A student
  // can share a progress summary with whoever is at the computer instead.
  const local = isLocalMode();
  const links = local ? undefined : (await api.GET("/v1/me/parent-links")).data;
  const sharing = local ? (await api.GET("/v1/local/me/parent-view")).data : undefined;
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
        {local ? (
          <Card as="section" aria-labelledby="sharing" className="flex flex-col gap-4">
            <h2 id="sharing" className="m-0 text-h3">
              Sharing your progress
            </h2>
            {sharing ? (
              <ProgressSharing
                on={sharing.on}
                pinNeeded={sharing.pin_needed}
                lastOpenedAt={sharing.last_opened_at}
              />
            ) : (
              <p className="m-0">Sharing could not be loaded. Try again in a moment.</p>
            )}
          </Card>
        ) : (
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
        )}
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
            {local ? "Delete this profile" : "Delete your account"}
          </h2>
          <DeleteForm local={local} />
        </Card>
      </div>
    </Page>
  );
}
