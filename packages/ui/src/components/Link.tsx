import type { AnchorHTMLAttributes } from "react";
import { cx } from "./cx";

/** For framework links (such as next/link) that need the same look. */
export const linkClassName =
  "text-ink underline decoration-1 underline-offset-4 hover:decoration-2";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Opens in a new tab, and says so to screen reader users. */
  external?: boolean;
}

export function Link({ external = false, className, children, ...rest }: LinkProps) {
  return (
    <a
      className={cx(linkClassName, className)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      {children}
      {/* The space sits outside the hidden span: accessible-name trimming would drop it inside. */}
      {external ? (
        <>
          {" "}
          <span className="sr-only">(opens in a new tab)</span>
        </>
      ) : null}
    </a>
  );
}
