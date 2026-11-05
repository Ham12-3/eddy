import { Card, EmptyState, ErrorState, linkClassName } from "@eddy/ui";
import NextLink from "next/link";
import { requireAdminPreview } from "@/lib/admin-gate";
import {
  fetchOverview,
  STRAND_TITLES,
  TIER_LABELS,
  type NodeSummary,
  type Topic,
} from "@/lib/curriculum";

export const dynamic = "force-dynamic";
export const metadata = { title: "Curriculum | Eddy admin" };

function NodeLink({ code }: { code: string }) {
  return (
    <NextLink
      href={`/admin/curriculum/${code}`}
      className={`${linkClassName} inline-flex min-h-11 min-w-11 items-center font-mono`}
    >
      {code}
    </NextLink>
  );
}

function Topics({ topics }: { topics: Topic[] }) {
  return (
    <section aria-labelledby="topics" className="mb-12">
      <h2 id="topics" className="m-0 mb-4 text-h3">
        Topics
      </h2>
      <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
        {topics.map((topic) => (
          <li key={topic.slug}>
            <Card as="article" className="h-full p-4">
              <h3 className="m-0 text-h4">
                <span className="mr-1 text-ink-muted">{topic.sort_order}.</span> {topic.title}
              </h3>
              <p className="m-0 mt-1 text-caption text-ink-muted">
                Scene primitive <code className="font-mono">{topic.scene_primitive}</code>
              </p>
              <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3">
                <span className="text-caption">Nodes</span>
                {topic.nodes.map((code) => (
                  <NodeLink key={code} code={code} />
                ))}
              </p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StrandTable({ strand, nodes }: { strand: NodeSummary["strand"]; nodes: NodeSummary[] }) {
  const id = `strand-${strand.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="mb-10">
      <h3 id={id} className="m-0 mb-3 text-h4">
        {STRAND_TITLES[strand]}
      </h3>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Code
            </th>
            <th scope="col" className="py-2 pr-4 font-semibold">
              Statement
            </th>
            <th scope="col" className="hidden py-2 pr-4 font-semibold md:table-cell">
              Tier
            </th>
            <th scope="col" className="hidden py-2 pr-4 font-semibold lg:table-cell">
              Builds on
            </th>
            <th scope="col" className="py-2 text-caption font-semibold">
              Misconceptions
            </th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.code} className="border-b border-rule align-top">
              <td className="pr-4">
                <NodeLink code={node.code} />
              </td>
              <td className="py-3 pr-4">{node.title}</td>
              <td className="hidden py-3 pr-4 md:table-cell">{TIER_LABELS[node.tier]}</td>
              <td className="hidden py-3 pr-4 font-mono text-caption lg:table-cell">
                {node.prerequisites.length > 0
                  ? node.prerequisites.map((p) => p.code).join(", ")
                  : "None"}
              </td>
              <td className="py-3 tabular-nums">{node.misconception_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Nodes({ nodes }: { nodes: NodeSummary[] }) {
  const strands = Object.keys(STRAND_TITLES) as NodeSummary["strand"][];
  return (
    <section aria-labelledby="nodes">
      <h2 id="nodes" className="m-0 mb-2 text-h3">
        Subject content
      </h2>
      <p className="m-0 mb-6 max-w-prose text-ink-muted">
        {nodes.length} statements from the DfE GCSE mathematics subject content. Exam board
        specifications build on these.
      </p>
      {strands.map((strand) => {
        const inStrand = nodes.filter((node) => node.strand === strand);
        return inStrand.length > 0 ? (
          <StrandTable key={strand} strand={strand} nodes={inStrand} />
        ) : null;
      })}
    </section>
  );
}

export default async function CurriculumPage() {
  requireAdminPreview();
  const result = await fetchOverview();
  return (
    <>
      <h1 className="m-0 mb-8">Curriculum</h1>
      {!result.ok ? (
        <ErrorState title="The curriculum could not be loaded" headingLevel={2}>
          The API did not answer. Check that <code className="font-mono">pnpm dev:api</code> is
          running and the database is seeded with <code className="font-mono">pnpm db:seed</code>.
        </ErrorState>
      ) : result.data.nodes.length === 0 ? (
        <EmptyState title="No curriculum yet" headingLevel={2}>
          The database has no curriculum. Run <code className="font-mono">pnpm db:seed</code> to
          load it from the YAML in <code className="font-mono">curriculum/</code>.
        </EmptyState>
      ) : (
        <>
          <Topics topics={result.data.topics} />
          <Nodes nodes={result.data.nodes} />
        </>
      )}
    </>
  );
}
