import type { ReactNode } from "react";

export interface QuestionCardProps {
  number?: number;
  /** The exam command word, such as "Work out" or "Show that". */
  commandWord: string;
  marks: number;
  /** Whether a calculator is allowed; omit when it does not matter. */
  calculator?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/** An exercise-book question: number in the margin, command word in small capitals, marks on the right. */
export function QuestionCard({
  number,
  commandWord,
  marks,
  calculator,
  children,
  footer,
}: QuestionCardProps) {
  return (
    <article
      aria-label={number === undefined ? "Question" : `Question ${number}`}
      className="relative rounded-card border border-rule bg-paper-raised py-6 pr-6 pl-16"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-12 w-px bg-field-border" />
      {number === undefined ? null : (
        <span
          aria-hidden="true"
          className="tabular absolute top-6 left-0 w-12 text-center font-display text-lead text-ink-muted"
        >
          {number}
        </span>
      )}
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="m-0 small-caps text-body font-semibold text-ink-muted">{commandWord}</p>
        <p className="m-0 tabular text-caption text-ink-muted">
          [{marks} {marks === 1 ? "mark" : "marks"}]
          {calculator === undefined ? null : (
            <span className="ml-3">{calculator ? "Calculator allowed" : "No calculator"}</span>
          )}
        </p>
      </header>
      <div className="text-lead">{children}</div>
      {footer ? <div className="mt-6">{footer}</div> : null}
    </article>
  );
}
