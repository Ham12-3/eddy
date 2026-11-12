"use client";

import { CheckboxField, TextField } from "@eddy/ui";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";

import { addChild, joinAsParent } from "./actions";

export function ParentJoinForm({ code }: { code?: string }) {
  const [state, action] = useActionState(joinAsParent, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <TextField
        label="Your child's code"
        name="code"
        defaultValue={code}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        error={state.fields?.code}
        className="max-w-sm"
      />
      <TextField
        label="Your email address"
        hint="We send a link here to sign you in."
        name="email"
        type="email"
        autoComplete="email"
        spellCheck={false}
        error={state.fields?.email}
        className="max-w-md"
      />
      <CheckboxField
        label="I am this student's parent or carer, and I am 18 or over"
        name="adult"
      />
      {state.fields?.adult ? (
        <p className="m-0 text-caption text-misconception">{state.fields.adult}</p>
      ) : null}
      <div>
        <SubmitButton>Send my link</SubmitButton>
      </div>
    </form>
  );
}

export function AddChildForm() {
  const [state, action] = useActionState(addChild, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError state={state} />
      <TextField
        label="Code from your child"
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        error={state.fields?.code}
        className="max-w-sm"
      />
      <div className="flex items-center gap-4">
        <SubmitButton variant="secondary">Ask to see their progress</SubmitButton>
        <p role="status" className="m-0 text-ink-muted">
          {state.fields?.sent ?? ""}
        </p>
      </div>
    </form>
  );
}
