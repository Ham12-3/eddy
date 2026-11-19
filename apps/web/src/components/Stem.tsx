import { Maths } from "@eddy/ui";

/**
 * A question stem from maths-core: plain text with maths between dollar signs ("Work out $3 + 4$.").
 * The text is rendered as text, never as HTML; the maths goes through KaTeX.
 */
export function Stem({ markdown }: { markdown: string }) {
  const parts = markdown.split(/(\$[^$]+\$)/g).filter(Boolean);
  return (
    <p className="m-0 text-lead">
      {parts.map((part, index) =>
        part.startsWith("$") && part.endsWith("$") ? (
          <Maths key={index} latex={part.slice(1, -1)} />
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}
