import type { components } from "@eddy/api-client";
import { ErrorState } from "@eddy/ui";
import type { Metadata } from "next";

import { Page } from "@/components/Page";
import { ParentDashboard } from "@/components/ParentDashboard";
import { isLocalMode } from "@/lib/local-mode";
import { requireStudent } from "@/lib/session";

type Dashboard = components["schemas"]["Dashboard"];

export function generateMetadata(): Metadata {
  return { title: isLocalMode() ? "What a parent or carer sees" : "What my parent sees" };
}

/**
 * The "what my parent sees" preview (SPEC.md section 4.4): the parent's page, exactly. In the
 * desktop app it is what anyone who opens "For parents and carers" on this computer sees, once
 * the student has switched sharing on (ADR-0036).
 */
export default async function ParentViewPage() {
  const { api } = await requireStudent({ onboarding: true });
  const local = isLocalMode();
  let data: Dashboard | undefined;
  /** Whether it is being shown now; undefined when Eddy could not find out. */
  let shared: boolean | undefined = true;
  if (local) {
    const mine = (await api.GET("/v1/local/me/parent-view")).data;
    data = mine?.progress;
    shared = mine?.on;
  } else {
    data = (await api.GET("/v1/me/parent-view")).data;
  }
  const lead = !local
    ? "This is exactly what a linked parent or carer sees. Nothing else is shared."
    : shared === undefined
      ? "What a parent or carer at this computer would see."
      : shared
        ? "This is exactly what anyone who opens For parents and carers on this computer sees. Nothing else is shown."
        : "Sharing is off, so nobody sees this. It is what would be shown if you switched sharing on in Settings.";
  return (
    <Page title={local ? "What a parent or carer sees" : "What my parent sees"} lead={lead}>
      {data ? (
        <ParentDashboard data={data} />
      ) : (
        <ErrorState title="This could not be loaded" headingLevel={2}>
          <p className="m-0">Try again in a moment.</p>
        </ErrorState>
      )}
    </Page>
  );
}
