import type { ReactNode } from "react";

/**
 * A page's main column: one readable measure, ruled down the left like an exercise book margin
 * on wider screens. Never centred-everything (SPEC.md section 11).
 */
export function Page({
  title,
  lead,
  children,
  wide = false,
}: {
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
  /** For the progress map and lesson: a wider column. */
  wide?: boolean;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className={`px-4 py-8 outline-none md:ml-[10vw] md:border-l md:border-rule md:px-8 md:py-12 ${
        wide ? "max-w-[96ch]" : "max-w-[68ch]"
      }`}
    >
      <h1 className="m-0 mb-4">{title}</h1>
      {lead ? <div className="m-0 mb-6 text-lead">{lead}</div> : null}
      {children}
    </main>
  );
}
