export type MasteryState = "not-started" | "learning" | "secure" | "needs-review";

export const MASTERY_LABELS: Record<MasteryState, string> = {
  "not-started": "Not started",
  learning: "Learning",
  secure: "Secure",
  "needs-review": "Needs review",
};

export interface ProgressMapNodeProps {
  title: string;
  state: MasteryState;
}

/**
 * One topic on the progress map, filled like ink as mastery grows: an empty ring, half full,
 * full, or full with a dashed ring when a review is due. The state is also written out.
 */
export function ProgressMapNode({ title, state }: ProgressMapNodeProps) {
  return (
    <div className="inline-flex w-32 flex-col items-center gap-1 text-center">
      <svg width={40} height={40} viewBox="0 0 40 40" aria-hidden="true" className="text-ink">
        <circle
          cx={20}
          cy={20}
          r={16}
          fill="var(--paper-raised)"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray={state === "needs-review" ? "4 3" : undefined}
        />
        {state === "learning" ? <path d="M6 20a14 14 0 0 0 28 0z" fill="currentColor" /> : null}
        {state === "secure" || state === "needs-review" ? (
          <circle cx={20} cy={20} r={state === "secure" ? 14 : 11} fill="currentColor" />
        ) : null}
      </svg>
      <span className="font-semibold leading-tight">{title}</span>
      <span className="text-caption text-ink-muted">{MASTERY_LABELS[state]}</span>
    </div>
  );
}
