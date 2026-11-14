import { buttonClassName, Card, ErrorState } from "@eddy/ui";
import type { Metadata } from "next";

import { Page } from "@/components/Page";
import { requireStudent } from "@/lib/session";

export const metadata: Metadata = { title: "My data" };

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const LABELS: Record<string, string> = {
  account: "Your account",
  profile: "Your set-up",
  notices_acknowledged: "Notices you acknowledged",
  answers: "Your answers",
  what_eddy_thinks_you_know: "What Eddy thinks you know",
  slips_noticed: "Slips Eddy noticed",
  reviews: "Reviews",
  lessons: "Lessons and messages",
  concerns_you_reported: "Concerns you reported",
  parent_links: "Parent links",
  data_requests: "Your data requests",
  invite: "The invite you joined with",
  explanations_watched: "Explanations you watched",
  first_questions: "Your first questions",
  signed_in_on: "Where you are signed in",
  safety_records: "Safety records",
};

function words(key: string): string {
  return key.replaceAll("_", " ");
}

/** A value from the export, shown as plain text, lists and tables: never as HTML. */
function Value({ value }: { value: Json }) {
  if (value === null) return <span className="text-ink-muted">none</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-muted">none</span>;
    return (
      <ol className="m-0 flex flex-col gap-2 pl-6">
        {value.map((item, index) => (
          <li key={index}>
            <Value value={item} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
      {Object.entries(value).map(([key, item]) => (
        <div key={key} className="contents">
          <dt className="font-semibold">{words(key)}</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">
            {typeof item === "object" && item !== null && !Array.isArray(item) ? (
              <code className="font-mono text-caption">{JSON.stringify(item)}</code>
            ) : (
              <Value value={item} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Download my data: a readable page, and the same as a file (SPEC.md section 4.5). */
export default async function MyDataPage() {
  const { api } = await requireStudent({ onboarding: true });
  const { data } = await api.GET("/v1/me/export");
  if (!data) {
    return (
      <Page title="My data">
        <ErrorState title="Your data could not be prepared" headingLevel={2}>
          <p className="m-0">Try again in a moment.</p>
        </ErrorState>
      </Page>
    );
  }
  const sections = Object.entries(data as Record<string, Json>).filter(([key]) => key in LABELS);
  return (
    <Page title="My data" lead="Everything Eddy holds about you, right now." wide>
      <p className="m-0 mb-6">
        <a href="/settings/my-data/download" className={buttonClassName("secondary")}>
          Download as a file
        </a>
      </p>
      <div className="flex flex-col gap-6">
        {sections.map(([key, value]) => (
          <Card
            key={key}
            as="section"
            aria-labelledby={`data-${key}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`data-${key}`} className="m-0 text-h3">
              {LABELS[key]}
            </h2>
            <Value value={value} />
          </Card>
        ))}
      </div>
    </Page>
  );
}
