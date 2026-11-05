import type { ReactNode } from "react";

export interface WorkingPadProps {
  label?: string;
  /** One entry per line of the student's working, oldest first. */
  lines: ReactNode[];
  emptyText?: string;
}

/** Lined paper for the student's working. Their working is always in the student colour. */
export function WorkingPad({
  label = "Your working",
  lines,
  emptyText = "Your working will appear here.",
}: WorkingPadProps) {
  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-caption font-semibold text-ink-muted">{label}</figcaption>
      <ol className="ruled-lines m-0 list-none rounded-control border border-field-border bg-paper-raised px-4 py-1 text-lead leading-[2.2] text-student">
        {lines.length === 0 ? (
          <li className="text-ink-muted">{emptyText}</li>
        ) : (
          lines.map((line, index) => <li key={index}>{line}</li>)
        )}
      </ol>
    </figure>
  );
}
