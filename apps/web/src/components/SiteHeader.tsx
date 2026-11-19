import { linkClassName } from "@eddy/ui";
import NextLink from "next/link";

import { SignOutButton } from "./SignOutButton";

const STUDENT_NAV = [
  { href: "/home", label: "Today" },
  { href: "/review", label: "Review" },
  { href: "/progress", label: "Progress" },
  { href: "/settings", label: "Settings" },
] as const;

/** The wordmark, and for a signed-in student the four places they go. */
export function SiteHeader({ signedIn, ready }: { signedIn: boolean; ready: boolean }) {
  return (
    <header className="border-b border-rule px-4 py-3 md:px-8">
      <div className="flex max-w-[68ch] flex-wrap items-center justify-between gap-x-6 gap-y-2 md:ml-[10vw]">
        <NextLink
          href={signedIn ? "/home" : "/"}
          className="inline-flex min-h-11 items-center font-display text-h4 font-semibold text-ink no-underline"
        >
          Eddy
        </NextLink>
        {signedIn ? (
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {ready
              ? STUDENT_NAV.map((item) => (
                  <NextLink
                    key={item.href}
                    href={item.href}
                    className={`${linkClassName} inline-flex min-h-11 items-center`}
                  >
                    {item.label}
                  </NextLink>
                ))
              : null}
            <SignOutButton />
          </nav>
        ) : (
          <NextLink
            href="/sign-in"
            className={`${linkClassName} inline-flex min-h-11 items-center`}
          >
            Sign in
          </NextLink>
        )}
      </div>
    </header>
  );
}
