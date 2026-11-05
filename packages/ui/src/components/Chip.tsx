import type { ReactNode } from "react";
import { cx } from "./cx";

export interface ChipProps {
  children: ReactNode;
  /** With onClick, the chip becomes a toggle button and this is its pressed state. */
  selected?: boolean;
  onClick?: () => void;
}

const base =
  "inline-flex items-center gap-1 rounded-control border px-3 text-caption font-semibold";

export function Chip({ children, selected = false, onClick }: ChipProps) {
  const look = selected
    ? "border-ink bg-ink text-paper-raised"
    : "border-field-border bg-paper-raised text-ink";
  if (!onClick) return <span className={cx(base, "min-h-8", look)}>{children}</span>;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      // Pressable chips meet the 44px target size; static ones can be smaller.
      className={cx(base, "min-h-11", look, !selected && "hover:bg-paper")}
    >
      {children}
    </button>
  );
}
