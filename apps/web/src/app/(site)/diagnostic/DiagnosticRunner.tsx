"use client";

import type { components } from "@eddy/api-client";
import { Button, buttonClassName, Card, Feedback, LiveRegion, Maths } from "@eddy/ui";
import NextLink from "next/link";
import { useState, useTransition } from "react";

import { AnswerBox, type AnswerSubmission } from "@/components/AnswerBox";
import { Stem } from "@/components/Stem";

import { answerDiagnostic, type RevealOut } from "./actions";

type DiagnosticOut = components["schemas"]["DiagnosticOut"];

export function DiagnosticRunner({ initial }: { initial: DiagnosticOut }) {
  const [current, setCurrent] = useState(initial);
  const [reveal, setReveal] = useState<RevealOut | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const question = current.question;

  function submit(answer: AnswerSubmission) {
    if (!question) return;
    startTransition(async () => {
      const result = await answerDiagnostic(current.id, question.item_id, answer);
      if (result.ok) {
        setError(undefined);
        setReveal(result.reveal);
      } else {
        setError(result.error);
      }
    });
  }

  if (current.done && !reveal) {
    return (
      <section aria-labelledby="done" className="flex flex-col gap-4">
        <h2 id="done" className="m-0 text-h3">
          That is everything
        </h2>
        <p className="m-0">
          Thank you. Eddy now has a first idea of what you know, and has planned where to start. It
          will keep learning as you go.
        </p>
        <div>
          <NextLink href="/home" className={buttonClassName("accent")}>
            See today&apos;s plan
          </NextLink>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 text-caption text-ink-muted">
        Question {question?.number ?? current.answered} of up to {current.limit}. Some questions may
        be on things you have not learned yet: that is fine.
      </p>
      {question ? (
        <Card as="section" aria-labelledby="question" className="flex flex-col gap-4">
          <h2 id="question" className="m-0 text-caption font-semibold text-ink-muted">
            {question.node_title}
            {question.calculator ? " (calculator allowed)" : " (no calculator)"}
          </h2>
          <Stem markdown={question.stem} />
        </Card>
      ) : null}
      <LiveRegion>
        {reveal ? (
          reveal.correct ? (
            <Feedback kind="correct" title="That is right">
              <p className="m-0">Well worked.</p>
            </Feedback>
          ) : (
            <Feedback kind={reveal.misconception ? "misconception" : "info"} title="Not this time">
              <p className="m-0">
                The answer is <Maths latex={reveal.answer_latex} />.
              </p>
              {reveal.misconception ? <p className="m-0 mt-2">{reveal.misconception}</p> : null}
              <p className="m-0 mt-2">Eddy will come back to this in your lessons.</p>
            </Feedback>
          )
        ) : null}
      </LiveRegion>
      {reveal ? (
        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="accent"
            onClick={() => {
              setCurrent(reveal.next);
              setReveal(null);
            }}
          >
            {reveal.next.done ? "Finish" : "Next question"}
          </Button>
          <NextLink href="/home" className={buttonClassName("quiet")}>
            Stop for now
          </NextLink>
        </div>
      ) : question ? (
        <AnswerBox
          key={question.item_id}
          onSubmit={submit}
          busy={pending}
          error={error}
          allowDontKnow
        />
      ) : null}
    </div>
  );
}
