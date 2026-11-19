import type { ReactNode } from "react";

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * A fieldset of radios whose whole label is the target (at least 44 px tall). Works without
 * JavaScript, so it suits server-action forms.
 */
export function RadioGroup({
  legend,
  name,
  options,
  defaultValue,
  hint,
  error,
  inline = false,
}: {
  legend: string;
  name: string;
  options: RadioOption[];
  defaultValue?: string;
  hint?: ReactNode;
  error?: string;
  inline?: boolean;
}) {
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <fieldset
      className="m-0 border-0 p-0"
      aria-describedby={describedBy || undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1 p-0 font-semibold">{legend}</legend>
      {hint ? (
        <p id={hintId} className="m-0 mb-2 text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
      <div className={inline ? "flex flex-wrap gap-x-6" : "flex flex-col"}>
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-11 items-start gap-3 py-2 ${
              option.disabled ? "cursor-not-allowed text-ink-muted" : "cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === defaultValue}
              disabled={option.disabled}
              className="mt-1 size-5 shrink-0 accent-ink"
            />
            <span className="flex flex-col">
              <span>{option.label}</span>
              {option.hint ? (
                <span className="text-caption text-ink-muted">{option.hint}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="m-0 mt-1 text-caption text-misconception">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
