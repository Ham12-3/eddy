import type { components } from "@eddy/api-client";
import { Button, ErrorState, Feedback, linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { Page } from "@/components/Page";
import { ParentDashboard } from "@/components/ParentDashboard";
import { apiClientFor } from "@/lib/api";
import { LOCAL_CALLER } from "@/lib/local-profile";

import { stopSharedProgress } from "../../actions";

export const metadata: Metadata = { title: "A student's progress" };
export const dynamic = "force-dynamic";

const LINK = `${linkClassName} inline-flex min-h-11 items-center`;

type SharedProgress = components["schemas"]["SharedProgress"];

/** The summary, "gone" when it is not shared (or never existed), or null when Eddy cannot say. */
async function summary(id: string): Promise<SharedProgress | "gone" | null> {
  try {
    const api = await apiClientFor(LOCAL_CALLER);
    const { data, response } = await api.GET("/v1/local/parent-view/{profile_id}", {
      params: { path: { profile_id: id } },
      signal: AbortSignal.timeout(15_000),
    });
    if (data) return data;
    return response.status === 404 ? "gone" : null;
  } catch {
    return null;
  }
}

/**
 * One student's progress summary, for a parent or carer at this computer (ADR-0036). It exists
 * only while the student has sharing switched on; anything else goes back to the list, so a
 * guessed address shows nothing and says nothing.
 */
export default async function SharedProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stopped?: string }>;
}) {
  const { id } = await params;
  const notStopped = (await searchParams).stopped === "no";
  if (!z.uuid().safeParse(id).success) redirect("/profiles/parents");
  const data = await summary(id);
  if (data === "gone") redirect("/profiles/parents");
  if (data === null) {
    return (
      <Page title="For parents and carers">
        <ErrorState title="This could not be loaded" headingLevel={2}>
          <p className="m-0">Eddy may still be starting. Try again in a moment.</p>
        </ErrorState>
        <p className="m-0 mt-6">
          <NextLink href="/profiles/parents" className={LINK}>
            Back to parents and carers
          </NextLink>
        </p>
      </Page>
    );
  }
  return (
    <Page
      title={`How ${data.name} is getting on`}
      lead={`What ${data.name} has chosen to share. Topics, lessons and reviews: never answers.`}
    >
      <ParentDashboard data={data.progress} />
      <section aria-labelledby="stop" className="mt-8 flex flex-col gap-3">
        <h2 id="stop" className="m-0 text-h3">
          Stop showing this
        </h2>
        <p className="m-0">
          If this should not be shown on this computer, anyone can stop it here. Only {data.name}{" "}
          can switch it on again, in their own Settings.
        </p>
        {notStopped ? (
          <div role="alert">
            <Feedback kind="info" title="That did not work">
              Eddy could not stop this just now, so it is still shown. Try again in a moment.
            </Feedback>
          </div>
        ) : null}
        <form action={stopSharedProgress}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="secondary">
            Stop showing this
          </Button>
        </form>
      </section>
      <p className="m-0 mt-6">
        <NextLink href="/profiles/parents" className={LINK}>
          Back to parents and carers
        </NextLink>
      </p>
    </Page>
  );
}
