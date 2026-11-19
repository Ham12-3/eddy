"use client";

import {
  Button,
  ConfidencePicker,
  LatexError,
  latexToMathJson,
  MathField,
  type Confidence,
  type MathJson,
} from "@eddy/ui";
import { useState } from "react";

export interface AnswerSubmission {
  mathjson: MathJson | null;
  confidence: Confidence;
  dontKnow: boolean;
}

/**
 * The maths field, then how sure the student is, then Check (SPEC.md section 4.2: confidence is
 * asked before marking). What they typed becomes MathJSON here; maths-core does the checking.
 */
export function AnswerBox({
  onSubmit,
  busy,
  error,
  allowDontKnow = false,
  askConfidence = true,
}: {
  onSubmit: (answer: AnswerSubmission) => void;
  busy: boolean;
  error?: string;
  allowDontKnow?: boolean;
  askConfidence?: boolean;
}) {
  const [latex, setLatex] = useState("");
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [problem, setProblem] = useState<string | undefined>();

  function submit(dontKnow: boolean) {
    if (dontKnow) {
      onSubmit({ mathjson: null, confidence: 1, dontKnow: true });
      return;
    }
    let mathjson: MathJson;
    try {
      mathjson = latexToMathJson(latex);
    } catch (caught) {
      setProblem(caught instanceof LatexError ? caught.message : "That answer could not be read.");
      return;
    }
    if (askConfidence && confidence === null) {
      setProblem("Say how sure you are first.");
      return;
    }
    setProblem(undefined);
    onSubmit({ mathjson, confidence: confidence ?? 3, dontKnow: false });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
    >
      <MathField
        label="Your answer"
        hint="Type it, or use the maths keys on a phone or tablet."
        value={latex}
        onChange={setLatex}
        error={problem ?? error}
      />
      {askConfidence ? (
        <ConfidencePicker legend="How sure are you?" value={confidence} onChange={setConfidence} />
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="accent" busy={busy}>
          Check my answer
        </Button>
        {allowDontKnow ? (
          <Button type="button" variant="quiet" busy={busy} onClick={() => submit(true)}>
            I do not know this yet
          </Button>
        ) : null}
      </div>
    </form>
  );
}
