import { buttonClassName, Card, EmptyState, ErrorState, Feedback } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { SubmitButton } from "@/components/forms";
import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

import { startLesson } from "../learn/actions";

export const metadata: Metadata = { title: "Today" };

/**
 * Today's plan (SPEC.md section 4.2): one new idea, due reviews and a re-check, with an honest
 * time estimate. Nothing that makes stopping feel like losing (Children's Code standard 13).
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { api } = await requireStudent();
  const { problem } = await searchParams;
  const { data: plan } = await api.GET("/v1/me/plan");
  if (!plan) {
    return (
      <Page title="Today">
        <ErrorState title="Today's plan could not be loaded" headingLevel={2}>
          <p className="m-0 mb-4">Your progress is safe. Try again in a moment.</p>
          <NextLink href="/home" className={buttonClassName("secondary")}>
            Try again
          </NextLink>
        </ErrorState>
      </Page>
    );
  }
  const somethingToDo = plan.node || plan.reviews.length > 0 || plan.recheck;
  return (
    <Page title="Today">
      <div className="flex flex-col gap-6">
        {problem ? (
          <Feedback kind="info" title="That lesson did not start">
            <p className="m-0">Eddy may be busy. Try again in a moment.</p>
          </Feedback>
        ) : null}
        {plan.open_lesson ? (
          <Card as="section" aria-labelledby="carry-on" className="flex flex-col gap-3">
            <h2 id="carry-on" className="m-0 text-h3">
              Carry on where you stopped
            </h2>
            <div>
              <NextLink href={`/learn/${plan.open_lesson}`} className={buttonClassName("accent")}>
                Carry on
              </NextLink>
            </div>
          </Card>
        ) : null}
        {!plan.diagnostic_done ? (
          <Card as="section" aria-labelledby="diagnostic" className="flex flex-col gap-3">
            <h2 id="diagnostic" className="m-0 text-h3">
              {plan.diagnostic_in_progress ? "Finish your first questions" : "Your first questions"}
            </h2>
            <p className="m-0">
              About 15 minutes of questions so Eddy knows where to start. You can stop at any point.
            </p>
            <div>
              <NextLink href="/diagnostic" className={buttonClassName("secondary")}>
                {plan.diagnostic_in_progress ? "Carry on" : "Start"}
              </NextLink>
            </div>
          </Card>
        ) : null}
        {somethingToDo ? (
          <Card as="section" aria-labelledby="plan" className="flex flex-col gap-4">
            <h2 id="plan" className="m-0 text-h3">
              Today&apos;s plan
            </h2>
            <ul className="m-0 flex flex-col gap-2 pl-6">
              {plan.recheck ? <li>A quick check on something you fixed recently</li> : null}
              {plan.node_title ? <li>Something new: {plan.node_title}</li> : null}
              {plan.reviews.length > 0 ? (
                <li>
                  {plan.reviews.length === 1
                    ? "One review of something you know"
                    : `${plan.reviews.length} reviews of things you know`}
                </li>
              ) : null}
            </ul>
            <p className="m-0 text-ink-muted">About {plan.minutes} minutes.</p>
            <form
              action={async () => {
                "use server";
                await startLesson();
              }}
            >
              <SubmitButton>{plan.open_lesson ? "Start a new lesson" : "Start"}</SubmitButton>
            </form>
          </Card>
        ) : (
          <EmptyState title="Nothing due today" headingLevel={2}>
            <p className="m-0">
              You are up to date. Your next review will appear here when it is due.
            </p>
          </EmptyState>
        )}
      </div>
    </Page>
  );
}
