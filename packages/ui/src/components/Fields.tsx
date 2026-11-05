"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cx } from "./cx";
import { SlipIcon } from "./icons";

interface FieldChrome {
  label: string;
  hint?: string;
  error?: string;
}

const control =
  "min-h-11 w-full rounded-control border border-field-border bg-paper-raised px-3 text-ink aria-invalid:border-misconception";

function useFieldIds({ hint, error }: Pick<FieldChrome, "hint" | "error">) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return { id, hintId, errorId, describedBy };
}

function FieldFrame({
  id,
  label,
  hint,
  hintId,
  error,
  errorId,
  children,
  className,
}: FieldChrome & {
  id: string;
  hintId: string;
  errorId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="m-0 text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} className="m-0 flex items-center gap-1 text-caption text-misconception">
          <SlipIcon width={16} height={16} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = FieldChrome & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

export function TextField({ label, hint, error, className, ...input }: TextFieldProps) {
  const ids = useFieldIds({ hint, error });
  return (
    <FieldFrame label={label} hint={hint} error={error} className={className} {...ids}>
      <input
        id={ids.id}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        className={control}
        {...input}
      />
    </FieldFrame>
  );
}

export type SelectFieldProps = FieldChrome &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
    options: Array<{ value: string; label: string }>;
  };

export function SelectField({
  label,
  hint,
  error,
  options,
  className,
  ...select
}: SelectFieldProps) {
  const ids = useFieldIds({ hint, error });
  return (
    <FieldFrame label={label} hint={hint} error={error} className={className} {...ids}>
      <select
        id={ids.id}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        className={control}
        {...select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

export type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & {
  label: string;
  hint?: string;
};

/** The label text is part of the target, so the small native box is never the only thing to hit. */
export function CheckboxField({ label, hint, className, ...input }: CheckboxFieldProps) {
  const { id, hintId } = useFieldIds({ hint });
  return (
    <div className={cx("flex min-h-11 items-start gap-3 py-2", className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint ? hintId : undefined}
        className="mt-1 size-5 shrink-0 accent-ink"
        {...input}
      />
      <span className="flex flex-col">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="text-caption text-ink-muted">
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  );
}
