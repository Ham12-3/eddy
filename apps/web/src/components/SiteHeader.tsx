import { linkClassName } from "@eddy/ui";
import NextLink from "next/link";

import { SignOutButton } from "./SignOutButton";

const NAV = {
  student: [
    { href: "/home", label: "Today" },
    { href: "/review", label: "Review" },
    { href: "/progress", label: "Progress" },
    { href: "/settings", label: "Settings" },
  ],
  parent: [{ href: "/parent", label: "Your children" }],
} as const;

/**
 * The wordmark and the places a signed-in person goes. While a parent can see a student's
 * progress, the student always sees so, with a way to see what the parent sees (SPEC.md 4.4).
 */
export function SiteHeader({
  role,
  parentVisible,
}: {
  role: "student" | "parent" | null;
  parentVisible: boolean;
}) {
  const nav = role ? NAV[role] : [];
  return (
    <header className="border-b border-rule">
      <div className="px-4 py-3 md:px-8">
        <div className="flex max-w-[68ch] flex-wrap items-center justify-between gap-x-6 gap-y-2 md:ml-[10vw]">
          <NextLink
            href={role === "parent" ? "/parent" : role ? "/home" : "/"}
            className="inline-flex min-h-11 items-center font-display text-h4 font-semibold text-ink no-underline"
          >
            Eddy
          </NextLink>
          {role ? (
            <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1">
              {nav.map((item) => (
                <NextLink
                  key={item.href}
                  href={item.href}
                  className={`${linkClassName} inline-flex min-h-11 items-center`}
                >
                  {item.label}
                </NextLink>
              ))}
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
      </div>
      {role === "student" && parentVisible ? (
        <p
          role="note"
          className="m-0 border-t border-rule bg-paper-raised px-4 text-caption md:px-8"
        >
          <span className="md:ml-[10vw]">
            Your parent can see your progress.{" "}
            <NextLink
              href="/settings/parent-view"
              className={`${linkClassName} inline-flex min-h-11 items-center`}
            >
              See what they see
            </NextLink>
          </span>
        </p>
      ) : null}
    </header>
  );
}
