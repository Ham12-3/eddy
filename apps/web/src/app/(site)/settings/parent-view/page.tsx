import { ErrorState } from "@eddy/ui";
import type { Metadata } from "next";

import { Page } from "@/components/Page";
import { ParentDashboard } from "@/components/ParentDashboard";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "What my parent sees" };

/** The "what my parent sees" preview (SPEC.md section 4.4): the parent's page, exactly. */
export default async function ParentViewPage() {
  const { api } = await requireStudent({ onboarding: true });
  const { data } = await api.GET("/v1/me/parent-view");
  return (
    <Page
      title="What my parent sees"
      lead="This is exactly what a linked parent or carer sees. Nothing else is shared."
    >
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
