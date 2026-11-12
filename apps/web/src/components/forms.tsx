"use client";

import { Button, Feedback, type ButtonVariant } from "@eddy/ui";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** What a form action returns: nothing, or the problem to show beside the form. */
export interface FormState {
  error?: string;
  /** Errors for single fields, by field name. */
  fields?: Record<string, string>;
}

export const initialFormState: FormState = {};

/** A submit button that shows it is busy while the action runs. */
export function SubmitButton({
  children,
  variant = "accent",
}: {
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} busy={pending}>
      {children}
    </Button>
  );
}

/** A form-level problem, announced to screen readers. */
export function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <div role="alert">
      <Feedback kind="info" title="That did not work">
        {state.error}
      </Feedback>
    </div>
  );
}
