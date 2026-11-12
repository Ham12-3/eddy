import { buttonClassName, ErrorState } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { SubmitButton } from "@/components/forms";
import { Page } from "@/components/Page";
import { ParentDashboard } from "@/components/ParentDashboard";
import { requireParent } from "@/lib/session";

import { endAsParent } from "../../actions";

export const metadata: Metadata = { title: "Progress" };

/** One child's progress. Each view is written to the audit log by services/api. */
export default async function ChildPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const { api } = await requireParent();
  const { data } = await api.GET("/v1/parent/children/{link_id}", {
    params: { path: { link_id: linkId } },
  });
  if (!data) {
    return (
      <Page title="Progress">
        <ErrorState title="This progress is not available" headingLevel={2}>
          <p className="m-0 mb-4">The link may have ended, or not been accepted yet.</p>
          <NextLink href="/parent" className={buttonClassName("secondary")}>
            Back to your children
          </NextLink>
        </ErrorState>
      </Page>
    );
  }
  return (
    <Page title="Progress" lead="What your child is working on in Eddy.">
      <ParentDashboard data={data} />
      <form
        className="mt-10 border-t border-rule pt-6"
        action={async () => {
          "use server";
          await endAsParent(linkId);
        }}
      >
        <p className="m-0 mb-3">Your child is told if you stop seeing their progress.</p>
        <SubmitButton variant="secondary">Stop seeing their progress</SubmitButton>
      </form>
    </Page>
  );
}
