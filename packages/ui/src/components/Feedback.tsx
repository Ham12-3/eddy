import type { ReactNode } from "react";
import { cx } from "./cx";
import { HintIcon, InfoIcon, SlipIcon, TickIcon } from "./icons";

export type FeedbackKind = "correct" | "misconception" | "hint" | "info";

const KINDS = {
  correct: { bar: "border-l-correct", icon: "text-correct", title: "Correct", Icon: TickIcon },
  misconception: {
    bar: "border-l-misconception",
    icon: "text-misconception",
    title: "A common slip",
    Icon: SlipIcon,
  },
  hint: { bar: "border-l-ink-muted", icon: "text-ink-muted", title: "Hint", Icon: HintIcon },
  info: { bar: "border-l-field-border", icon: "text-ink-muted", title: "Note", Icon: InfoIcon },
} as const;

export interface FeedbackProps {
  kind: FeedbackKind;
  title?: string;
  children: ReactNode;
}

/**
 * Kind, specific feedback. Never a red screen: the colour sits on a narrow bar and an icon, the
 * text stays ink, and each kind has its own icon shape and title so colour is never the only cue.
 * Feedback that appears after an action belongs inside a LiveRegion, so it is announced.
 */
export function Feedback({ kind, title, children }: FeedbackProps) {
  const { bar, icon, title: defaultTitle, Icon } = KINDS[kind];
  return (
    <div
      className={cx(
        "flex gap-3 rounded-card border border-l-4 border-rule bg-paper-raised p-4",
        bar,
      )}
    >
      <Icon className={cx("mt-1 shrink-0", icon)} />
      <div>
        <p className="m-0 font-semibold">{title ?? defaultTitle}</p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * A polite live region. Keep it mounted and change what is inside: screen readers announce a
 * region's new content reliably, but often stay silent for a region that arrives already filled.
 */
export function LiveRegion({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={className}>
      {children}
    </div>
  );
}
