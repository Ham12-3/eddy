import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { cx } from "./cx";

/**
 * primary: ink fill, the default. accent: marker orange, for the single main action on a screen.
 * secondary: outlined. quiet: text-style, for low-emphasis actions.
 */
export type ButtonVariant = "primary" | "accent" | "secondary" | "quiet";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper-raised hover:bg-ink/85",
  accent: "bg-accent text-on-accent hover:bg-accent/85",
  secondary: "border border-field-border bg-paper-raised text-ink hover:bg-paper",
  quiet: "text-ink underline decoration-1 underline-offset-4 hover:decoration-2",
};

export const buttonClassName = (variant: ButtonVariant = "primary") =>
  cx(
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-5",
    "font-body text-body leading-tight font-semibold",
    "transition-colors duration-[120ms] ease-standard",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "aria-disabled:cursor-progress aria-disabled:opacity-60",
    VARIANTS[variant],
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Marks the button busy and ignores presses while something is saving. */
  busy?: boolean;
}

function ignorePress(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export function Button({
  variant = "primary",
  busy = false,
  className,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // aria-disabled, not disabled: a disabled button would drop keyboard focus to the page.
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? ignorePress : onClick}
      className={cx(buttonClassName(variant), className)}
      {...rest}
    />
  );
}
