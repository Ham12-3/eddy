import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article";
}

/** Raised paper with a hairline rule. No shadow: elevation comes from the paper tone. */
export function Card({ as: Tag = "div", className, ...rest }: CardProps) {
  return (
    <Tag
      className={cx("rounded-card border border-rule bg-paper-raised p-6", className)}
      {...rest}
    />
  );
}
