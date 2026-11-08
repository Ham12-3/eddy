import katex from "katex";
import { cx } from "./cx";

/** Colour roles from the scene language: what the maths is, not what it looks like. */
export type MathsTone = "given" | "student" | "correct" | "misconception";

const TONES: Record<MathsTone, string> = {
  given: "text-ink",
  student: "text-student",
  correct: "text-correct",
  misconception: "text-misconception",
};

export interface MathsProps {
  latex: string;
  /** Display (block) maths rather than inline. */
  display?: boolean;
  tone?: MathsTone;
  className?: string;
}

/**
 * Renders LaTeX with KaTeX on the server or client. Output includes MathML, which is what screen
 * readers read; the visual HTML is hidden from them. Untrusted commands such as \href are off.
 */
export function Maths({ latex, display = false, tone = "given", className }: MathsProps) {
  const html = katex.renderToString(latex, {
    displayMode: display,
    output: "htmlAndMathml",
    throwOnError: false,
    errorColor: "currentColor",
    trust: false,
    strict: "ignore",
  });
  const Tag = display ? "div" : "span";
  return (
    <Tag
      className={cx(TONES[tone], display && "my-3 overflow-x-auto", className)}
      // KaTeX escapes its input, and trust: false blocks link and HTML commands.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
