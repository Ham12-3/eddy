import { linkClassName } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";

import { ParentJoinForm } from "../ParentForms";

export const metadata: Metadata = { title: "For parents" };

/** A parent arrives with the link their child shared, or types the code (ADR-0033). */
export default async function ParentJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const clean = code && /^[A-Za-z0-9-]{4,32}$/.test(code) ? code : undefined;
  return (
    <Page
      title="See your child's progress"
      lead="Your child can share their progress in Eddy with you. They choose to, and they can stop at any time."
    >
      <p className="m-0 mb-6">
        You will see the topics they have secured, how much time they spent, and when reviews are
        due. You will not see their messages or their answers. Nothing is shared until your child
        accepts. Read the{" "}
        <NextLink href="/privacy/full" className={linkClassName}>
          privacy notice
        </NextLink>{" "}
        for what we keep about you.
      </p>
      <ParentJoinForm code={clean} />
    </Page>
  );
}
