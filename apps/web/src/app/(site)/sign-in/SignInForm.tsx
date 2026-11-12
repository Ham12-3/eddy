"use client";

import { TextField } from "@eddy/ui";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";

import { sendSignInLink } from "./actions";

export function SignInForm() {
  const [state, action] = useActionState(sendSignInLink, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <TextField
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        spellCheck={false}
        required
        error={state.fields?.email}
        className="max-w-md"
      />
      <div>
        <SubmitButton>Email me a link</SubmitButton>
      </div>
    </form>
  );
}
