"use client";

import { Button, buttonClassName, SelectField, TextField } from "@eddy/ui";
import NextLink from "next/link";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";
import { MONTHS } from "@/lib/months";

import { createProfile, openProfile } from "./actions";

export interface PickerProfile {
  id: string;
  name: string;
  has_pin: boolean;
}

const ROW = "w-full max-w-sm justify-between! gap-4 text-left";

/**
 * One row per profile. A profile with no PIN opens straight away; one with a PIN is a link to
 * the page that asks for it, so choosing a name is never counted as a guess at its PIN.
 */
export function ProfileList({ profiles }: { profiles: PickerProfile[] }) {
  const [state, action, pending] = useActionState(openProfile, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {profiles.map((profile) => (
          <li key={profile.id}>
            {profile.has_pin ? (
              <NextLink
                href={`/profiles/${profile.id}`}
                className={`${buttonClassName("secondary")} ${ROW}`}
              >
                <span className="break-words">{profile.name}</span>
                <span className="text-caption font-normal text-ink-muted">PIN needed</span>
              </NextLink>
            ) : (
              <Button
                type="submit"
                name="id"
                value={profile.id}
                variant="secondary"
                busy={pending}
                className={ROW}
              >
                <span className="break-words">{profile.name}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </form>
  );
}

/**
 * A nickname, the same neutral age question as online, and an optional PIN. After a problem the
 * name and birth date come back filled in; the PIN is never sent back.
 */
export function NewProfileForm({ thisYear }: { thisYear: number }) {
  const [state, action] = useActionState(createProfile, initialFormState);
  const years = Array.from({ length: 90 }, (_, index) => String(thisYear - 5 - index));
  const values = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <TextField
        label="What should Eddy call this profile?"
        hint="A first name or a nickname. It only shows on this computer."
        name="name"
        autoComplete="off"
        maxLength={24}
        required
        defaultValue={values.name ?? ""}
        error={state.fields?.name}
        className="max-w-sm"
      />
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="mb-2 p-0 font-semibold">When were you born?</legend>
        {/* The key remounts the list with what was chosen: after a form action React resets a
            select to its first default, not to a new defaultValue. */}
        <SelectField
          key={`month-${values.month ?? ""}`}
          label="Month"
          name="month"
          required
          defaultValue={values.month ?? ""}
          options={[
            { value: "", label: "Choose a month" },
            ...MONTHS.map((month, index) => ({ value: String(index + 1), label: month })),
          ]}
          className="w-48"
        />
        <SelectField
          key={`year-${values.year ?? ""}`}
          label="Year"
          name="year"
          required
          defaultValue={values.year ?? ""}
          options={[
            { value: "", label: "Choose a year" },
            ...years.map((year) => ({ value: year, label: year })),
          ]}
          className="w-40"
        />
      </fieldset>
      <TextField
        label="PIN (optional)"
        hint="4 to 8 digits. A PIN stops other people here opening your profile from the list. Without one, anyone using this computer can open it. Eddy cannot show or reset a PIN: if you forget it, your work in this profile is lost."
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        error={state.fields?.pin}
        className="max-w-xs"
      />
      <TextField
        label="Type the PIN again"
        hint="Only if you chose a PIN. It is typed twice so that one slip does not lock you out."
        name="pin_again"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        error={state.fields?.pin_again}
        className="max-w-xs"
      />
      <div>
        <SubmitButton>Make my profile</SubmitButton>
      </div>
    </form>
  );
}

export function PinForm({ id }: { id: string }) {
  const [state, action] = useActionState(openProfile, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <FormError state={state} />
      <input type="hidden" name="id" value={id} />
      <TextField
        label="PIN"
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        required
        error={state.fields?.pin}
        className="max-w-xs"
      />
      <div>
        <SubmitButton>Open my profile</SubmitButton>
      </div>
    </form>
  );
}
