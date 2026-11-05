"use client";

import { useId } from "react";
import { TickIcon } from "./icons";

export const CONFIDENCE_LEVELS = [
  { value: 1, label: "Guessing" },
  { value: 2, label: "Unsure" },
  { value: 3, label: "Fairly sure" },
  { value: 4, label: "Certain" },
] as const;

export type Confidence = (typeof CONFIDENCE_LEVELS)[number]["value"];

export interface ConfidencePickerProps {
  value: Confidence | null;
  onChange: (value: Confidence) => void;
  legend?: string;
}

/** Asked before marking. Native radios, so arrow keys move between levels. */
export function ConfidencePicker({
  value,
  onChange,
  legend = "How sure are you?",
}: ConfidencePickerProps) {
  const name = useId();
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 p-0 font-semibold">{legend}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CONFIDENCE_LEVELS.map((level) => (
          <label
            key={level.value}
            className="group flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-field-border bg-paper-raised px-3 py-2 has-checked:border-ink has-checked:bg-ink has-checked:text-paper-raised has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={level.value}
              checked={value === level.value}
              onChange={() => onChange(level.value)}
            />
            <TickIcon width={16} height={16} className="invisible group-has-checked:visible" />
            {level.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
