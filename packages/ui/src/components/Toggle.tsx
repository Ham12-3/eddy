"use client";

import { useId } from "react";

export interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off switch. The whole row is the target; the knob position and fill show the state. */
export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      // Named by the label alone; the description is read as a description, not repeated.
      aria-labelledby={labelId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={() => onChange(!checked)}
      className="group flex min-h-11 w-full items-center justify-between gap-4 rounded-control py-2 text-left"
    >
      <span className="flex flex-col">
        <span id={labelId} className="font-semibold">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="text-caption text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-field-border bg-paper-raised transition-colors group-aria-checked:border-ink group-aria-checked:bg-ink" // cliche-lint-allow: pill (toggle track)
      >
        <span
          className="size-5 translate-x-0.5 rounded-full bg-field-border transition-transform duration-[120ms] group-aria-checked:translate-x-5.5 group-aria-checked:bg-paper-raised" // cliche-lint-allow: pill (toggle knob)
        />
      </span>
    </button>
  );
}
