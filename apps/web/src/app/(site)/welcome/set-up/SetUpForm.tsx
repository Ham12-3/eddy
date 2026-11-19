"use client";

import { CheckboxField, SelectField } from "@eddy/ui";
import { useActionState } from "react";

import { FormError, initialFormState, SubmitButton } from "@/components/forms";
import { RadioGroup } from "@/components/RadioGroup";
import type { Me } from "@/lib/session";

import { saveSetUp } from "../actions";

export interface SeriesOption {
  value: string;
  label: string;
}

export function SetUpForm({ me, series }: { me: Me; series: SeriesOption[] }) {
  const [state, action] = useActionState(saveSetUp, initialFormState);
  const { profile, preferences } = me;
  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <FormError state={state} />
      <section aria-labelledby="exams" className="flex flex-col gap-6">
        <h2 id="exams" className="m-0 text-h3">
          Your exams
        </h2>
        <RadioGroup
          legend="Exam board"
          name="board"
          hint="Your teacher will know if you are not sure. AQA is the most common."
          defaultValue={profile.board ?? "AQA"}
          error={state.fields?.board}
          inline
          options={[
            { value: "AQA", label: "AQA" },
            { value: "EDEXCEL", label: "Edexcel" },
            { value: "OCR", label: "OCR" },
          ]}
        />
        <RadioGroup
          legend="Tier"
          name="tier"
          defaultValue="FOUNDATION"
          options={[
            { value: "FOUNDATION", label: "Foundation" },
            { value: "HIGHER", label: "Higher", hint: "Coming later", disabled: true },
          ]}
        />
        <SelectField
          label="When do you take your exams?"
          name="exam_series"
          defaultValue={profile.exam_series ?? ""}
          error={state.fields?.exam_series}
          options={[{ value: "", label: "Choose a sitting" }, ...series]}
          className="max-w-sm"
        />
        <RadioGroup
          legend="The grade you are aiming for"
          name="target_grade"
          defaultValue={profile.target_grade ? String(profile.target_grade) : undefined}
          error={state.fields?.target_grade}
          inline
          options={[
            { value: "4", label: "Grade 4", hint: "A standard pass" },
            { value: "5", label: "Grade 5", hint: "A strong pass" },
          ]}
        />
        <RadioGroup
          legend="Are you resitting GCSE Maths?"
          name="is_resitter"
          defaultValue={
            profile.setup_completed_at ? (profile.is_resitter ? "yes" : "no") : undefined
          }
          error={state.fields?.is_resitter}
          inline
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes" },
          ]}
        />
      </section>
      <section aria-labelledby="display" className="flex flex-col gap-4">
        <h2 id="display" className="m-0 text-h3">
          How Eddy looks and sounds
        </h2>
        <RadioGroup
          legend="Colours"
          name="theme"
          defaultValue={preferences.theme}
          error={state.fields?.theme}
          inline
          options={[
            { value: "system", label: "Match my device" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <CheckboxField
          label="Dyslexia-friendly text"
          hint="A font and spacing many dyslexic readers find easier."
          name="dyslexia"
          defaultChecked={preferences.reading === "dyslexia"}
        />
        <CheckboxField
          label="Reduce motion"
          hint="Explanations fade between steps instead of moving."
          name="reduce_motion"
          defaultChecked={preferences.motion === "reduce"}
        />
        <CheckboxField
          label="Captions only"
          hint="Explanations show their words on screen without reading them aloud."
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
      </section>
      <div>
        <SubmitButton>Save and continue</SubmitButton>
      </div>
    </form>
  );
}
