"use client";

import { Button, ErrorState } from "@eddy/ui";

/** Anything unexpected on a student page: plain words, no blame, a way forward. */
export default function SiteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main
      id="main"
      className="max-w-[68ch] px-4 py-8 md:ml-[10vw] md:border-l md:border-rule md:px-8 md:py-12"
    >
      <h1 className="sr-only">Something went wrong</h1>
      <ErrorState title="Something went wrong on our side" headingLevel={2}>
        <p className="m-0 mb-4">Your work is saved. Try again, or come back in a few minutes.</p>
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </ErrorState>
    </main>
  );
}
