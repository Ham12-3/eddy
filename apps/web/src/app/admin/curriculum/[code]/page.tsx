import { Card, EmptyState, ErrorState, Link, linkClassName } from "@eddy/ui";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireAdminPreview } from "@/lib/admin-gate";
import {
  fetchNode,
  isNodeCode,
  STRAND_TITLES,
  TIER_LABELS,
  type Misconception,
  type NodeDetail,
} from "@/lib/curriculum";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params) {
  requireAdminPreview();
  const { code } = await params;
  return { title: isNodeCode(code) ? `${code} | Eddy admin` : "Eddy admin" };
}

function NodeLinks({ codes, empty }: { codes: string[]; empty: string }) {
  if (codes.length === 0) return <span className="text-ink-muted">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-x-3">
      {codes.map((code) => (
        <NextLink
          key={code}
          href={`/admin/curriculum/${code}`}
          className={`${linkClassName} inline-flex min-h-11 min-w-11 items-center font-mono`}
        >
          {code}
        </NextLink>
      ))}
    </span>
  );
}

function Facts({ node }: { node: NodeDetail }) {
  const rows: [string, ReactNode][] = [
    ["Strand", STRAND_TITLES[node.strand]],
    ["Tier", TIER_LABELS[node.tier]],
    ["Suits animation", `${node.visual_suitability} of 3`],
    ["Topics", node.topics.length > 0 ? node.topics.join(", ") : "Not an MVP topic"],
    [
      "Builds on",
      <NodeLinks key="p" codes={node.prerequisites.map((p) => p.code)} empty="Nothing (a root)" />,
    ],
    ["Leads to", <NodeLinks key="d" codes={node.dependents} empty="No recorded dependents" />],
  ];
  return (
    <dl className="m-0 mb-10 border-t border-rule">
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="grid grid-cols-1 gap-x-6 border-b border-rule py-3 sm:grid-cols-[10rem_1fr] sm:items-center"
        >
          <dt className="font-semibold">{term}</dt>
          <dd className="m-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const EVIDENCE_LABELS: Record<string, string> = {
  "brief-s2": "The research summary in docs/brief.md section 2",
  practice: "Widely documented in UK teaching; to confirm against Eddy's own data",
};

function Evidence({ source }: { source: string }) {
  if (source.startsWith("https://")) {
    return (
      <Link href={source} external className="break-all">
        {source}
      </Link>
    );
  }
  return <>{EVIDENCE_LABELS[source] ?? source}</>;
}

function rulesText(m: Misconception): string {
  return (m.detection_rules ?? [])
    .map((rule) =>
      rule.type === "classifier" ? "classifier (can only suspect)" : `${rule.type} ${rule.rule}`,
    )
    .join("; ");
}

function MisconceptionCard({ m }: { m: Misconception }) {
  return (
    <Card as="article" className="p-4 md:p-6">
      <h3 className="m-0 text-h4">{m.title}</h3>
      <p className="m-0 mt-1 font-mono text-caption text-ink-muted">{m.code}</p>
      <h4 className="m-0 mt-4 text-body font-semibold">What the student reads</h4>
      <p className="m-0 mt-1 max-w-prose">{m.student_facing_description}</p>
      <h4 className="m-0 mt-4 text-body font-semibold">For teachers</h4>
      <p className="m-0 mt-1 max-w-prose">{m.teacher_description ?? "Not shown to this role."}</p>
      <dl className="m-0 mt-4 grid grid-cols-1 gap-x-4 text-caption sm:grid-cols-[8rem_1fr]">
        <dt className="font-semibold">Detection</dt>
        <dd className="m-0 mb-2 font-mono break-words">{rulesText(m)}</dd>
        <dt className="font-semibold">Scene</dt>
        <dd className="m-0 mb-2 font-mono break-words">{m.remediation_template ?? "None yet"}</dd>
        <dt className="font-semibold">Re-check family</dt>
        <dd className="m-0 mb-2 font-mono break-words">{m.recheck_family ?? "None yet"}</dd>
        <dt className="font-semibold">Evidence</dt>
        <dd className="m-0">
          <Evidence source={m.evidence_source} />
        </dd>
      </dl>
    </Card>
  );
}

export default async function NodePage({ params }: Params) {
  requireAdminPreview();
  const { code } = await params;
  const result = await fetchNode(code);
  if (!result.ok && result.reason === "missing") notFound();

  return (
    <>
      <p className="m-0 mb-4">
        <NextLink
          href="/admin/curriculum"
          className={`${linkClassName} inline-flex min-h-11 items-center`}
        >
          All of the curriculum
        </NextLink>
      </p>
      {!result.ok ? (
        <>
          <h1 className="m-0 mb-8 font-mono">{code}</h1>
          <ErrorState title="This node could not be loaded" headingLevel={2}>
            The API did not answer. Check that <code className="font-mono">pnpm dev:api</code> is
            running.
          </ErrorState>
        </>
      ) : (
        <>
          <h1 className="m-0 mb-4">
            <span className="mr-3 font-mono text-ink-muted">{result.data.code}</span>
            {result.data.title}
          </h1>
          <p className="m-0 mb-2 max-w-prose text-lead">{result.data.description}</p>
          {result.data.higher_extension ? (
            <p className="m-0 mb-2 max-w-prose">
              <span className="font-semibold">Higher tier also: </span>
              {result.data.higher_extension}
            </p>
          ) : null}
          <div className="mt-8">
            <Facts node={result.data} />
          </div>
          <section aria-labelledby="misconceptions">
            <h2 id="misconceptions" className="m-0 mb-4 text-h3">
              Misconceptions ({result.data.misconceptions.length})
            </h2>
            {result.data.misconceptions.length === 0 ? (
              <EmptyState title="None recorded" headingLevel={3}>
                No misconceptions are recorded for this node yet. Add one with the
                /new-misconception skill.
              </EmptyState>
            ) : (
              <div className="grid gap-4">
                {result.data.misconceptions.map((m) => (
                  <MisconceptionCard key={m.code} m={m} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
