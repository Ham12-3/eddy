import type { ReactNode } from "react";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { signedInRole, signedInStudent } from "@/lib/session";

/** Every student-facing page: a skip link, the header, the page, and the footer. */
export default async function SiteLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [student, role] = await Promise.all([signedInStudent(), signedInRole()]);
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-control focus:bg-paper-raised focus:px-4"
      >
        Skip to content
      </a>
      {/* Layouts do not re-render on client navigation, so the nav shows whenever a student is
          signed in; each page sends anyone mid-onboarding to their next step. */}
      <SiteHeader
        role={student ? "student" : role === "parent" ? "parent" : null}
        parentVisible={student?.me.parent_visible ?? false}
      />
      {children}
      <SiteFooter />
    </>
  );
}
