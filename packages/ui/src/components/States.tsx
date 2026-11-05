import type { ReactNode } from "react";
import { cx } from "./cx";
import { RuledLinesIcon, SlipIcon } from "./icons";

/** A placeholder block while content loads. It pulses gently, and not at all with reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx("animate-pulse rounded-control bg-rule", className)} />
  );
}

/** Placeholder lines for a loading paragraph. Pair it with aria-busy on the region it fills. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx("h-4", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export interface StateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Heading level, so the state fits the page outline. */
  headingLevel?: 2 | 3 | 4;
}

/** Nothing here yet: says why, and what to do next. */
export function EmptyState({ title, children, action, headingLevel = 3 }: StateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className="flex flex-col items-start gap-3 rounded-card border border-dashed border-field-border p-8">
      <RuledLinesIcon className="text-ink-muted" />
      <Heading className="m-0 text-h4">{title}</Heading>
      {children ? <div className="max-w-prose text-ink-muted">{children}</div> : null}
      {action}
    </section>
  );
}

/** Something went wrong: plain words, no blame, a way forward. */
export function ErrorState({ title, children, action, headingLevel = 3 }: StateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className="flex flex-col items-start gap-3 rounded-card border border-l-4 border-rule border-l-misconception bg-paper-raised p-8">
      <SlipIcon width={28} height={28} className="text-misconception" />
      <Heading className="m-0 text-h4">{title}</Heading>
      {children ? <div className="max-w-prose">{children}</div> : null}
      {action}
    </section>
  );
}
