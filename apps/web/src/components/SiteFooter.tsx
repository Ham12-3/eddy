import { linkClassName } from "@eddy/ui";
import NextLink from "next/link";

/**
 * On every page (SPEC.md section 4.5): report a concern, the privacy notice, and who to contact
 * straight away. Nothing here asks for attention.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule px-4 py-8 md:px-8">
      <div className="flex max-w-[68ch] flex-col gap-4 md:ml-[10vw]">
        <nav aria-label="Help and privacy" className="flex flex-wrap gap-x-6 gap-y-1">
          <NextLink
            href="/concern"
            className={`${linkClassName} inline-flex min-h-11 items-center`}
          >
            Report a concern
          </NextLink>
          <NextLink
            href="/privacy"
            className={`${linkClassName} inline-flex min-h-11 items-center`}
          >
            Privacy notice
          </NextLink>
        </nav>
        <p className="m-0 text-caption text-ink-muted">
          If you need to talk to someone now: Childline on 0800 1111, or text SHOUT to 85258. In an
          emergency, call 999.
        </p>
      </div>
    </footer>
  );
}
