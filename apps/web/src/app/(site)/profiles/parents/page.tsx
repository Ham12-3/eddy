import { buttonClassName, EmptyState, ErrorState, linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { apiClientFor } from "@/lib/api";
import { LOCAL_CALLER } from "@/lib/local-profile";

export const metadata: Metadata = { title: "For parents and carers" };
// Who is sharing, as it is now.
export const dynamic = "force-dynamic";

const LINK = `${linkClassName} inline-flex min-h-11 items-center`;

interface SharedProfile {
  id: string;
  name: string;
}

async function sharing(): Promise<SharedProfile[] | null> {
  try {
    const api = await apiClientFor(LOCAL_CALLER);
    const { data } = await api.GET("/v1/local/parent-view", {
      signal: AbortSignal.timeout(15_000),
    });
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * The desktop app's parent view (ADR-0036). There are no parent accounts on a computer: a student
 * switches a progress summary on in their own Settings, and it is listed here for whoever is at
 * the computer. A profile that has not switched it on is not named at all.
 */
export default async function ParentsPage() {
  const list = await sharing();
  return (
    <Page
      title="For parents and carers"
      lead="See how a student is getting on, if they have chosen to share it."
    >
      {list === null ? (
        <ErrorState title="This could not be loaded" headingLevel={2}>
          <p className="m-0">Eddy may still be starting. Try again in a moment.</p>
        </ErrorState>
      ) : list.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {list.map((profile) => (
            <li key={profile.id}>
              <NextLink
                href={`/profiles/parents/${profile.id}`}
                // Opening a summary is written down, so it is only ever fetched by a click.
                prefetch={false}
                className={`${buttonClassName("secondary")} w-full max-w-sm justify-start! text-left`}
              >
                <span className="break-words">How {profile.name} is getting on</span>
              </NextLink>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nobody is sharing their progress" headingLevel={2}>
          <p className="m-0">
            A student switches this on in their own Settings, under Sharing your progress. It is
            their choice.
          </p>
        </EmptyState>
      )}
      <p className="m-0 mt-8">
        Eddy shows the topics a student has secured and is working on, the days of their last few
        lessons with how many questions and minutes, and when reviews are due. It never shows their
        answers.
      </p>
      <p className="m-0 mt-6">
        <NextLink href="/profiles" className={LINK}>
          Back to the profiles
        </NextLink>
      </p>
    </Page>
  );
}
