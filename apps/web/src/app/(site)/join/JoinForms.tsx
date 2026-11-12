"use client";

import { SelectField, TextField } from "@eddy/ui";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";

import { checkAge, checkInvite, sendSignUpLink } from "./actions";

export function InviteForm() {
  const [state, action] = useActionState(checkInvite, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <TextField
        label="Invite code"
        hint="It might look like EDDY-4821. Capitals and spaces do not matter."
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
        error={state.fields?.code}
        className="max-w-sm"
      />
      <div>
        <SubmitButton>Continue</SubmitButton>
      </div>
    </form>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Month and year only, on a neutral screen that never shows the cut-off (SPEC.md section 4.1).
 * The year list runs back far enough for adult resit students.
 */
export function AgeForm({ thisYear }: { thisYear: number }) {
  const [state, action] = useActionState(checkAge, initialFormState);
  const years = Array.from({ length: 90 }, (_, index) => String(thisYear - 5 - index));
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="mb-2 p-0 font-semibold">When were you born?</legend>
        <SelectField
          label="Month"
          name="month"
          required
          defaultValue=""
          options={[
            { value: "", label: "Choose a month" },
            ...MONTHS.map((month, index) => ({ value: String(index + 1), label: month })),
          ]}
          className="w-48"
        />
        <SelectField
          label="Year"
          name="year"
          required
          defaultValue=""
          options={[
            { value: "", label: "Choose a year" },
            ...years.map((year) => ({ value: year, label: year })),
          ]}
          className="w-40"
        />
      </fieldset>
      <div>
        <SubmitButton>Continue</SubmitButton>
      </div>
    </form>
  );
}

export function EmailForm() {
  const [state, action] = useActionState(sendSignUpLink, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <TextField
        label="Email address"
        hint="We send a link here to sign you in. No password to remember."
        name="email"
        type="email"
        autoComplete="email"
        spellCheck={false}
        required
        error={state.fields?.email}
        className="max-w-md"
      />
      <div>
        <SubmitButton>Send my link</SubmitButton>
      </div>
    </form>
  );
}
