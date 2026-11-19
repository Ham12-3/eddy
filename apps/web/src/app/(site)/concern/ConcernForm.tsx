"use client";

import { Feedback } from "@eddy/ui";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";
import { RadioGroup } from "@/components/RadioGroup";

import { reportConcern } from "./actions";

export function ConcernForm({ lesson }: { lesson?: string }) {
  const [state, action] = useActionState(reportConcern, initialFormState);
  if (state.fields?.sent) {
    return (
      <div role="status">
        <Feedback kind="info" title="Thank you, we have your report">
          <p className="m-0">A person at Eddy will read it. If you are in danger now, call 999.</p>
        </Feedback>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <input type="hidden" name="lesson" value={lesson ?? ""} />
      <RadioGroup
        legend="What is it about?"
        name="category"
        options={[
          { value: "SAFETY", label: "My safety, or someone else's" },
          { value: "CONTENT", label: "Something Eddy said or showed" },
          { value: "PRIVACY", label: "My data or privacy" },
          { value: "OTHER", label: "Something else" },
        ]}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="concern-message" className="font-semibold">
          What happened?
        </label>
        <p id="concern-hint" className="m-0 text-caption text-ink-muted">
          Write as much or as little as you like.
        </p>
        <textarea
          id="concern-message"
          name="message"
          rows={5}
          maxLength={2000}
          aria-describedby={state.fields?.message ? "concern-hint concern-error" : "concern-hint"}
          aria-invalid={state.fields?.message ? true : undefined}
          className="w-full rounded-control border border-field-border bg-paper-raised p-3 text-ink"
        />
        {state.fields?.message ? (
          <p id="concern-error" className="m-0 text-caption text-misconception">
            {state.fields.message}
          </p>
        ) : null}
      </div>
      <div>
        <SubmitButton>Send report</SubmitButton>
      </div>
    </form>
  );
}
