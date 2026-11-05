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
  const hintId = `${id}-hint`;
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

  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1">
      <span className="font-semibold" aria-hidden="true">
        {label}
      </span>
      {hint ? (
        <p id={hintId} className="m-0 text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
      <math-field
        ref={field}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={error ? "true" : undefined}
        math-virtual-keyboard-policy="auto"
        placeholder={placeholder}
        data-ready={ready ? "true" : undefined}
      />
      {error ? (
        <p id={errorId} className="m-0 flex items-center gap-1 text-caption text-misconception">
          <SlipIcon width={16} height={16} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
