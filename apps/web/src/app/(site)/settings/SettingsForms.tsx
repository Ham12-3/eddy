"use client";

import { CheckboxField, SelectField, TextField } from "@eddy/ui";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";
import { RadioGroup } from "@/components/RadioGroup";
import type { Preferences } from "@/lib/session";

import { deleteAccount, savePreferences } from "./actions";

export function PreferencesForm({ preferences }: { preferences: Preferences }) {
  const [state, action] = useActionState(savePreferences, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <RadioGroup
        legend="Colours"
        name="theme"
        defaultValue={preferences.theme}
        inline
        options={[
          { value: "system", label: "Match my device" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
      <CheckboxField
        label="Dyslexia-friendly text"
        name="dyslexia"
        defaultChecked={preferences.reading === "dyslexia"}
      />
      <CheckboxField
        label="Reduce motion"
        name="reduce_motion"
        defaultChecked={preferences.motion === "reduce"}
      />
      <CheckboxField
        label="Captions only"
        hint="Explanations show their words without reading them aloud."
        name="captions_only"
        defaultChecked={preferences.captions_only}
      />
      <SelectField
        label="Narration speed"
        name="narration_speed"
        defaultValue={String(preferences.narration_speed)}
        options={[
          { value: "0.75", label: "Slower" },
          { value: "1", label: "Normal" },
          { value: "1.25", label: "Faster" },
        ]}
        className="max-w-xs"
      />
      <SelectField
        label="Suggest a break after"
        name="session_minutes"
        defaultValue={String(preferences.session_minutes)}
        options={[15, 20, 25, 30, 40, 50].map((m) => ({ value: String(m), label: `${m} minutes` }))}
        className="max-w-xs"
      />
      <div className="flex items-center gap-4">
        <SubmitButton variant="primary">Save settings</SubmitButton>
        <p role="status" className="m-0 text-ink-muted">
          {state.fields?.saved ?? ""}
        </p>
      </div>
    </form>
  );
}

export function DeleteForm() {
  const [state, action] = useActionState(deleteAccount, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError state={state} />
      <p className="m-0">
        Your account stops working straight away and you are signed out. Everything about you is
        erased within 30 days. This cannot be undone.
      </p>
      <TextField
        label="Type DELETE to confirm"
        name="confirm"
        autoComplete="off"
        error={state.fields?.confirm}
        className="max-w-xs"
      />
      <div>
        <SubmitButton variant="secondary">Delete my account</SubmitButton>
      </div>
    </form>
  );
}
