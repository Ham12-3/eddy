import { buttonClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { signedInStudent } from "@/lib/session";

import { ConcernForm } from "./ConcernForm";

export const metadata: Metadata = { title: "Report a concern" };

const HELP = (
  <section aria-labelledby="now" className="mb-8">
    <h2 id="now" className="m-0 mb-3 text-h3">
      If you need help now
    </h2>
    <ul className="m-0 flex flex-col gap-2 pl-6">
      <li>In an emergency, call 999.</li>
      <li>Childline: call 0800 1111, free, any time.</li>
      <li>Shout: text SHOUT to 85258, free, any time.</li>
    </ul>
  </section>
);

/** Always reachable from the footer and the tutor panel (SPEC.md section 4.5). */
export default async function ConcernPage({
  searchParams,
}: {
  searchParams: Promise<{ lesson?: string }>;
}) {
  const { lesson } = await searchParams;
  const student = await signedInStudent();
  return (
    <Page
      title="Report a concern"
      lead="Tell us if something worried you, felt wrong, or if you are worried about yourself or someone else."
    >
      {HELP}
      {student ? (
        <ConcernForm lesson={lesson && /^[0-9a-f-]{36}$/.test(lesson) ? lesson : undefined} />
      ) : (
        <p className="m-0">
          <NextLink href="/sign-in" className={buttonClassName("secondary")}>
            Sign in to send a report
          </NextLink>
        </p>
      )}
    </Page>
  );
}
