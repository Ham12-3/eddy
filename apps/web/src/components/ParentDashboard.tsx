import type { components } from "@eddy/api-client";
import { Card, EmptyState } from "@eddy/ui";

type Dashboard = components["schemas"]["Dashboard"];

const day = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

/**
 * What a linked parent sees (SPEC.md section 4.4): progress, never messages or answers. The
 * student's "what my parent sees" preview renders this same component.
 */
export function ParentDashboard({ data }: { data: Dashboard }) {
  return (
    <div className="flex flex-col gap-6">
      <Card as="section" aria-labelledby="secured" className="flex flex-col gap-3">
        <h2 id="secured" className="m-0 text-h3">
          Topics secured
        </h2>
        {data.secured.length ? (
          <ul className="m-0 flex flex-col gap-1 pl-6">
            {data.secured.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-ink-muted">None yet. Topics appear here once they are secure.</p>
        )}
        {data.learning.length ? (
          <p className="m-0">Working on: {data.learning.join(", ")}.</p>
        ) : null}
      </Card>
      <Card as="section" aria-labelledby="this-week" className="flex flex-col gap-3">
        <h2 id="this-week" className="m-0 text-h3">
          This week
        </h2>
        <p className="m-0">
          About {data.minutes_this_week} {data.minutes_this_week === 1 ? "minute" : "minutes"} on
          questions in the last 7 days.
        </p>
        <p className="m-0">
          {data.reviews_due_this_week === 0
            ? "No reviews due in the next 7 days."
            : `${data.reviews_due_this_week} ${
                data.reviews_due_this_week === 1 ? "review" : "reviews"
              } due in the next 7 days.`}
          {data.next_review ? ` The next is on ${day.format(new Date(data.next_review))}.` : ""}
        </p>
      </Card>
      <section aria-labelledby="recent" className="flex flex-col gap-3">
        <h2 id="recent" className="m-0 text-h3">
          Recent lessons
        </h2>
        {data.recent.length ? (
          <ul className="m-0 flex flex-col gap-2 pl-6">
            {data.recent.map((activity) => (
              <li key={activity.day}>
                {day.format(new Date(activity.day))}: {activity.questions}{" "}
                {activity.questions === 1 ? "question" : "questions"}, about {activity.minutes}{" "}
                {activity.minutes === 1 ? "minute" : "minutes"}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No lessons yet" headingLevel={3}>
            <p className="m-0">Lessons appear here after they happen.</p>
          </EmptyState>
        )}
      </section>
      <section aria-labelledby="support" className="flex flex-col gap-2">
        <h2 id="support" className="m-0 text-h3">
          Support and safeguarding
        </h2>
        <p className="m-0">
          If you are worried about a child&apos;s safety, call 999 in an emergency, or the NSPCC
          helpline on 0808 800 5000. Young people can call Childline on 0800 1111 or text SHOUT to
          85258.
        </p>
      </section>
    </div>
  );
}
