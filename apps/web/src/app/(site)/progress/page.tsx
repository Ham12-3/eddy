import { buttonClassName, EmptyState, ErrorState, MASTERY_LABELS, ProgressMapNode } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "Progress" };

const STRAND_NAMES: Record<string, string> = {
  NUMBER: "Number",
  RATIO: "Ratio and proportion",
  ALGEBRA: "Algebra",
  GEOMETRY: "Geometry",
  PROBABILITY: "Probability",
  STATISTICS: "Statistics",
};

/**
 * The progress map (SPEC.md section 4.3): each idea filled like ink, in four states, grouped by
 * strand. Never a percentage as the main signal.
 */
export default async function ProgressPage() {
  const { api } = await requireStudent();
  const { data } = await api.GET("/v1/me/progress");
  if (!data) {
    return (
      <Page title="Progress">
        <ErrorState title="Your progress could not be loaded" headingLevel={2}>
          <p className="m-0 mb-4">It is safe. Try again in a moment.</p>
          <NextLink href="/progress" className={buttonClassName("secondary")}>
            Try again
          </NextLink>
        </ErrorState>
      </Page>
    );
  }
  const started = data.nodes.some((node) => node.state !== "not-started");
  const strands = [...new Set(data.nodes.map((node) => node.strand))];
  return (
    <Page
      title="Progress"
      lead="Each idea fills in as it becomes secure. Ideas that need a look again say so."
      wide
    >
      {!started ? (
        <div className="mb-8">
          <EmptyState title="Nothing filled in yet" headingLevel={2}>
            <p className="m-0">Your map fills in as you answer questions and finish lessons.</p>
          </EmptyState>
        </div>
      ) : null}
      <p className="m-0 mb-6 text-ink-muted">Key: {Object.values(MASTERY_LABELS).join(", ")}.</p>
      {strands.map((strand) => (
        <section key={strand} aria-labelledby={`strand-${strand}`} className="mb-8">
          <h2 id={`strand-${strand}`} className="m-0 mb-3 text-h3">
            {STRAND_NAMES[strand] ?? strand}
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {data.nodes
              .filter((node) => node.strand === strand)
              .map((node) => (
                <li key={node.code}>
                  <ProgressMapNode title={node.title} state={node.state} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </Page>
  );
}
