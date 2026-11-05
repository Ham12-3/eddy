"use client";

import type { MathfieldElement, VirtualKeyboardLayout } from "mathlive";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DetailedHTMLProps,
  type HTMLAttributes,
} from "react";
import { SlipIcon } from "./icons";

// JSX typing for MathLive's <math-field>. It lives here so every app that imports MathField gets it.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "math-field": DetailedHTMLProps<HTMLAttributes<MathfieldElement>, MathfieldElement> & {
        "math-virtual-keyboard-policy"?: "auto" | "manual" | "sandboxed";
        "default-mode"?: "math" | "inline-math" | "text";
        placeholder?: string;
      };
    }
  }
}

/** The keys a Foundation student needs, on one screen. */
export const FOUNDATION_KEYBOARD: VirtualKeyboardLayout = {
  id: "eddy-foundation",
  label: "Maths",
  tooltip: "GCSE Foundation keys",
  rows: [
    ["7", "8", "9", "\\div", "[backspace]"],
    ["4", "5", "6", "\\times", "\\frac{#@}{#?}"],
    ["1", "2", "3", "-", "#@^{#?}"],
    ["0", ".", "=", "+", "\\sqrt{#0}"],
    ["(", ")", "x", "\\pi", "\\%"],
    ["\\mathrm{cm}", "\\mathrm{m}", "\\mathrm{kg}", "\\mathrm{g}", "\\mathrm{s}"],
    ["[left]", "[right]", "\\pounds", "\\degree", "[return]"],
  ],
};

let loading: Promise<void> | undefined;

/** Loads MathLive in the browser once. No fonts or sounds are fetched from anywhere else. */
function loadMathLive(): Promise<void> {
  loading ??= import("mathlive").then(({ MathfieldElement }) => {
    MathfieldElement.fontsDirectory = null; // KaTeX's fonts come from @eddy/ui/assets
    MathfieldElement.soundsDirectory = null;
    MathfieldElement.locale = "en";
    window.mathVirtualKeyboard.layouts = [FOUNDATION_KEYBOARD];
  });
  return loading;
}

export interface MathFieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** LaTeX. MathJSON for checking arrives with maths-core in M3. */
  value?: string;
  onChange?: (latex: string) => void;
  placeholder?: string;
}

/**
 * The student's maths input (MathLive). Works with a physical keyboard alone; on touch screens it
 * offers the Foundation keyboard. MathLive speaks the maths through its own live region.
 *
 * Focus lands on a textbox inside MathLive's shadow DOM, which ARIA ID references cannot reach
 * and to which MathLive copies only the label. So the hint and error are set on that textbox as
 * aria-description and aria-invalid, and a new error is also announced through a live region.
 */
export function MathField({
  label,
  hint,
  error,
  value = "",
  onChange,
  placeholder,
}: MathFieldProps) {
  const id = useId();
  const field = useRef<MathfieldElement>(null);
  const [ready, setReady] = useState(false);
  const errorId = `${id}-error`;

  useEffect(() => {
    let active = true;
    void loadMathLive().then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const element = field.current;
    if (ready && element && element.value !== value) element.value = value;
  }, [ready, value]);

  useEffect(() => {
    const element = field.current;
    if (!ready || !element || !onChange) return;
    const handleInput = () => onChange(element.value);
    element.addEventListener("input", handleInput);
    return () => element.removeEventListener("input", handleInput);
  }, [ready, onChange]);

  useEffect(() => {
    const textbox = field.current?.shadowRoot?.querySelector<HTMLElement>('[part="keyboard-sink"]');
    if (!ready || !textbox) return;
    const description = [hint, error].filter(Boolean).join(" ");
    if (description) textbox.setAttribute("aria-description", description);
    else textbox.removeAttribute("aria-description");
    if (error) textbox.setAttribute("aria-invalid", "true");
    else textbox.removeAttribute("aria-invalid");
  }, [ready, hint, error]);

  return (
    <div className="flex flex-col gap-1">
      {/* Not a <label>: MathLive takes its name from aria-label. Clicking still focuses the field. */}
      <span
        className="cursor-pointer self-start font-semibold"
        aria-hidden="true"
        onClick={() => field.current?.focus()}
      >
        {label}
      </span>
      {hint ? (
        <p className="m-0 text-caption text-ink-muted" aria-hidden="true">
          {hint}
        </p>
      ) : null}
      <math-field
        ref={field}
        aria-label={label}
        math-virtual-keyboard-policy="auto"
        placeholder={placeholder}
        data-invalid={error ? "true" : undefined}
        data-ready={ready ? "true" : undefined}
      />
      {/* Always present, so a new error is announced when it appears. */}
      <p
        id={errorId}
        aria-live="polite"
        className="m-0 flex items-center gap-1 text-caption text-misconception"
      >
        {error ? (
          <>
            <SlipIcon width={16} height={16} />
            {error}
          </>
        ) : null}
      </p>
    </div>
  );
}
