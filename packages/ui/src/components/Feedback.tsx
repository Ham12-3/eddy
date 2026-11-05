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
 */
export function Feedback({ kind, title, children }: FeedbackProps) {
  const { bar, icon, title: defaultTitle, Icon } = KINDS[kind];
  return (
    <section
      role="status"
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
    </section>
  );
}
