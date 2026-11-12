"use client";

import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";

import { acknowledgePrivacy } from "../actions";

export function AcknowledgeForm() {
  const [state, action] = useActionState(acknowledgePrivacy, initialFormState);
  return (
    <form action={action} className="mt-10 flex flex-col gap-4 border-t border-rule pt-8">
      <FormError state={state} />
      <p className="m-0">
        You can read this again at any time from the link at the bottom of every page.
      </p>
      <div>
        <SubmitButton>I have read this</SubmitButton>
      </div>
    </form>
  );
}
