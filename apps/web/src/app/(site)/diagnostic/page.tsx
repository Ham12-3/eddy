import { buttonClassName, ErrorState } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

import { DiagnosticRunner } from "./DiagnosticRunner";

export const metadata: Metadata = { title: "Getting started" };

export default async function DiagnosticPage() {
  const { api } = await requireStudent();
  const { data } = await api.POST("/v1/diagnostic");
  if (!data) {
    return (
      <Page title="Getting started">
        <ErrorState title="Eddy cannot load your questions just now" headingLevel={2}>
          <p className="m-0 mb-4">Nothing is lost. Try again in a moment.</p>
          <NextLink href="/diagnostic" className={buttonClassName("secondary")}>
            Try again
          </NextLink>
        </ErrorState>
      </Page>
    );
  }
  return (
    <Page
      title="Getting started"
      lead="A few questions so Eddy knows where to begin. It takes about 15 minutes, and you can stop and carry on later."
    >
      <DiagnosticRunner initial={data} />
    </Page>
  );
}
