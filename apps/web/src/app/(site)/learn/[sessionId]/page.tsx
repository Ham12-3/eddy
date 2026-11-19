import { buttonClassName, ErrorState } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

import { LessonRunner } from "./LessonRunner";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { api, me } = await requireStudent();
  const { data } = await api.GET("/v1/tutor/sessions/{session_id}", {
    params: { path: { session_id: sessionId } },
  });
  if (!data) {
    return (
      <Page title="Lesson">
        <ErrorState title="This lesson could not be opened" headingLevel={2}>
          <p className="m-0 mb-4">It may belong to another account, or Eddy may be busy.</p>
          <NextLink href="/home" className={buttonClassName("secondary")}>
            Back to today
          </NextLink>
        </ErrorState>
      </Page>
    );
  }
  return (
    <Page title="Lesson" wide>
      <LessonRunner initial={data} preferences={me.preferences} />
    </Page>
  );
}
