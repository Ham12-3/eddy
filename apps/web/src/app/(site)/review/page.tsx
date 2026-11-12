import { buttonClassName, Card, EmptyState, ErrorState } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { SubmitButton } from "@/components/forms";
import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

import { startLesson } from "../learn/actions";

export const metadata: Metadata = { title: "Review" };

/** Reviews due today, scheduled by FSRS (SPEC.md section 4.3). Mixed up once 3 ideas are secure. */
export default async function ReviewPage() {
  const { api } = await requireStudent();
  const [{ data: plan }, { data: progress }] = await Promise.all([
    api.GET("/v1/me/plan"),
    api.GET("/v1/me/progress"),
  ]);
  if (!plan || !progress) {
    return (
      <Page title="Review">
        <ErrorState title="Your reviews could not be loaded" headingLevel={2}>
          <p className="m-0 mb-4">Try again in a moment.</p>
          <NextLink href="/review" className={buttonClassName("secondary")}>
            Try again
          </NextLink>
        </ErrorState>
      </Page>
    );
  }
  const titles = new Map(progress.nodes.map((node) => [node.code, node.title]));
  if (plan.reviews.length === 0) {
    return (
      <Page title="Review">
        <EmptyState title="No reviews due" headingLevel={2}>
          <p className="m-0">
            Reviews come back a few days after something becomes secure, just before you might
            forget it. They will appear here when they are due.
          </p>
        </EmptyState>
      </Page>
    );
  }
  return (
    <Page title="Review" lead="Short questions on things you know, so they stay put.">
      <Card as="section" aria-labelledby="due" className="flex flex-col gap-4">
        <h2 id="due" className="m-0 text-h3">
          Due today
        </h2>
        <ul className="m-0 flex flex-col gap-2 pl-6">
          {plan.reviews.map((code) => (
            <li key={code}>{titles.get(code) ?? code}</li>
          ))}
        </ul>
        <form
          action={async () => {
            "use server";
            await startLesson();
          }}
        >
          <SubmitButton>Start reviewing</SubmitButton>
        </form>
      </Card>
    </Page>
  );
}
