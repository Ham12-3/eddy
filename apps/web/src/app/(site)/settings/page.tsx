import { Card } from "@eddy/ui";
import type { Metadata } from "next";

import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

import { DeleteForm, ExportForm, PreferencesForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Settings" };

/** Display choices, and the data rights two clicks from anywhere (SPEC.md section 4.5). */
export default async function SettingsPage() {
  // Reachable before onboarding is finished: deleting an account never waits on a notice.
  const { api, me } = await requireStudent({ onboarding: true });
  const { data: requests } = await api.GET("/v1/me/data-requests");
  const exportPending = (requests ?? []).some(
    (request) => request.kind === "EXPORT" && request.status !== "COMPLETED",
  );
  return (
    <Page title="Settings">
      <div className="flex flex-col gap-8">
        <Card as="section" aria-labelledby="display" className="flex flex-col gap-4">
          <h2 id="display" className="m-0 text-h3">
            How Eddy looks and sounds
          </h2>
          <PreferencesForm preferences={me.preferences} />
        </Card>
        <Card as="section" aria-labelledby="your-data" className="flex flex-col gap-4">
          <h2 id="your-data" className="m-0 text-h3">
            Your data
          </h2>
          <ExportForm pending={exportPending} />
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
