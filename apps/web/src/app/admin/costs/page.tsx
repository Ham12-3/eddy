import { Card, EmptyState, ErrorState } from "@eddy/ui";

import { requireAdminPreview } from "@/lib/admin-gate";
import { isAdminPreviewEnabled } from "@/lib/admin-preview";
import { apiClientFor } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Costs | Eddy admin" };

// The admin preview signs as an admin with a non-user subject (ADR-0018) until admin accounts
// exist; the page exists only in development or with EDDY_ADMIN_PREVIEW=1.
const CALLER = { subject: "preview:admin-costs", role: "admin" } as const;

const pounds = (value: number) =>
  value < 1 ? `${(value * 100).toFixed(1)}p` : `£${value.toFixed(2)}`;

/**
 * The cost dashboard (PLAN.md M10): Claude spend from `llm_call` by route and by day. Narration
 * costs nothing (the device's own voice, ADR-0029). Hosting is not deployed, so it has no
 * measured cost yet: docs/staging-plan.md lists what to price.
 */
export default async function CostsPage() {
  requireAdminPreview();
  if (!isAdminPreviewEnabled()) return null;
  const api = await apiClientFor(CALLER);
  const { data } = await api.GET("/v1/admin/costs", { params: { query: { days: 30 } } });
  return (
    <div>
      <h1 className="m-0 mb-2">Costs</h1>
      <p className="m-0 mb-8 text-lead">
        Claude spend over the last 30 days, from the call records.
      </p>
      {!data ? (
        <ErrorState title="Costs could not be loaded" headingLevel={2}>
          <p className="m-0">Is the API running?</p>
        </ErrorState>
      ) : data.by_route.length === 0 ? (
        <EmptyState title="No Claude calls in the last 30 days" headingLevel={2}>
          <p className="m-0">Costs appear here once lessons or scenes call Claude.</p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          <Card as="section" aria-labelledby="totals" className="flex flex-col gap-2">
            <h2 id="totals" className="m-0 text-h3">
              Totals
            </h2>
            <p className="m-0">
              {pounds(data.total_gbp)} in total; {data.lessons} lessons started.
            </p>
            <p className="m-0">
              Tutor spend per lesson:{" "}
              {data.per_lesson_gbp === null ? "no lessons yet" : pounds(data.per_lesson_gbp)} (an
              estimate: tutor and safety calls divided by lessons started).
            </p>
            <p className="m-0 text-ink-muted">
              Narration: no cost (the device&apos;s own voice). Hosting: not deployed, so not yet
              measured.
            </p>
          </Card>
          <section aria-labelledby="routes">
            <h2 id="routes" className="m-0 mb-3 text-h3">
              By route
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left tabular-nums">
                <thead>
                  <tr className="border-b border-rule">
                    <th scope="col" className="py-2 pr-4">
                      Route
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Calls
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Cost
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Tokens in / out / cached
                    </th>
                    <th scope="col" className="py-2">
                      p95 time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_route.map((row) => (
                    <tr key={row.route} className="border-b border-rule">
                      <th scope="row" className="py-2 pr-4 font-mono font-normal">
                        {row.route}
                      </th>
                      <td className="py-2 pr-4">{row.calls}</td>
                      <td className="py-2 pr-4">{pounds(row.cost_gbp)}</td>
                      <td className="py-2 pr-4">
                        {row.input_tokens} / {row.output_tokens} / {row.cached_tokens}
                      </td>
                      <td className="py-2">{(row.p95_latency_ms / 1000).toFixed(1)} s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="days">
            <h2 id="days" className="m-0 mb-3 text-h3">
              By day
            </h2>
            <ul className="m-0 flex flex-col gap-1 pl-6 tabular-nums">
              {data.by_day.map((row) => (
                <li key={row.day}>
                  {row.day}: {pounds(row.cost_gbp)} over {row.calls} calls
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
