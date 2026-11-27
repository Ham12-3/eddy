"use client";

import { linkClassName, TextField } from "@eddy/ui";
import NextLink from "next/link";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";

import { setProgressSharing } from "./actions";

const day = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

/**
 * Sharing progress in the desktop app (ADR-0036). There are no parent accounts on a computer, so
 * a student who wants a parent or carer to see how they are doing switches a summary on. It is
 * then open to whoever uses this computer, without the profile's PIN, and the words here say so,
 * and say everything that is shown, before anything is switched on. Switching on asks for the
 * PIN, so a profile left open cannot be opened up for good by someone else. Switching off never
 * does.
 */
export function ProgressSharing({
  on,
  pinNeeded,
  lastOpenedAt,
}: {
  on: boolean;
  pinNeeded: boolean;
  lastOpenedAt: string | null;
}) {
  const [state, action] = useActionState(setProgressSharing, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <p className="m-0">
        You can let a parent or carer see how you are getting on. They would see:
      </p>
      <ul className="m-0 flex flex-col gap-1 pl-6">
        <li>the topics you have secured, and the ones you are still working on</li>
        <li>the days of your last few lessons, with how many questions and minutes</li>
        <li>how many minutes you spent this week</li>
        <li>when reviews are due</li>
      </ul>
      <p className="m-0">
        Never your answers.{" "}
        <NextLink href="/settings/parent-view" className={linkClassName}>
          See exactly what they would see
        </NextLink>
        .
      </p>
      <p className="m-0">
        Eddy has no accounts for parents. So while this is on, anyone using this computer can see it
        from &ldquo;For parents and carers&rdquo; on the profile list, and they do not need your
        PIN. Anyone can stop it being shown from there too.
      </p>
      <p role="status" className="m-0 font-semibold">
        {on ? "Your progress is shared on this computer." : "Your progress is not shared."}
      </p>
      {on ? (
        <p className="m-0 text-ink-muted">
          {lastOpenedAt
            ? `It was last opened on ${day.format(new Date(lastOpenedAt))}.`
            : "Nobody has opened it yet."}
        </p>
      ) : null}
      <FormError state={state} />
      <input type="hidden" name="on" value={on ? "false" : "true"} />
      {!on && pinNeeded ? (
        <TextField
          label="Your PIN"
          hint="Sharing lets people see this without your PIN, so Eddy checks it is you."
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          required
          error={state.fields?.pin}
          className="max-w-xs"
        />
      ) : null}
      <div>
        <SubmitButton variant="secondary">{on ? "Stop sharing" : "Share my progress"}</SubmitButton>
      </div>
    </form>
  );
}
