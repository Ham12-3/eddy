"use client";

import {
  Button,
  buttonClassName,
  Card,
  ConfidencePicker,
  Feedback,
  linkClassName,
  LiveRegion,
  type Confidence,
} from "@eddy/ui";
import NextLink from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { AnswerBox, type AnswerSubmission } from "@/components/AnswerBox";
import { Stem } from "@/components/Stem";
import type { Preferences } from "@/lib/session";

import { sendInput, type LessonInput, type LessonOut } from "../actions";
import { LessonScene } from "./LessonScene";

type Entry = Record<string, unknown> & { type: string; turn?: number };

function text(entry: Entry, key: string): string {
  const value = entry[key];
  return typeof value === "string" ? value : "";
}

/** One thing the lesson showed: a tutor message, a question, a mark, a scene, the script. */
function OutboxEntry({ entry, preferences }: { entry: Entry; preferences: Preferences }) {
  switch (entry.type) {
    case "tutor":
      return (
        <div className="rounded-card border border-rule bg-paper-raised p-4">
          <p className="m-0 mb-1 text-caption font-semibold text-ink-muted">Eddy</p>
          <p className="m-0 whitespace-pre-line">{text(entry, "text")}</p>
        </div>
      );
    case "student":
      return (
        <div className="ml-auto max-w-[85%] rounded-card border border-rule p-4">
          <p className="m-0 mb-1 text-caption font-semibold text-ink-muted">You</p>
          <p className="m-0 whitespace-pre-line text-student">{text(entry, "text")}</p>
        </div>
      );
    case "item":
      return (
        <Card as="section" aria-label="Question" className="flex flex-col gap-2">
          {entry.faded ? (
            <p className="m-0 text-caption text-ink-muted">Finish this one off</p>
          ) : null}
          <Stem markdown={text(entry, "stem")} />
        </Card>
      );
    case "marked":
      return entry.correct ? (
        <Feedback kind="correct" title="That is right">
          <p className="m-0">Well worked.</p>
        </Feedback>
      ) : (
        <Feedback kind="info" title="Not quite">
          <p className="m-0">Let&apos;s look at it together.</p>
        </Feedback>
      );
    case "scene":
      return (
        <LessonScene
          spec={entry.spec}
          reduceMotion={preferences.motion === "reduce"}
          captionsOnly={preferences.captions_only}
        />
      );
    case "unreadable":
      return (
        <Feedback kind="info" title="Eddy could not read that">
          <p className="m-0">{text(entry, "text")}</p>
        </Feedback>
      );
    case "script":
      return (
        <section
          aria-labelledby="support"
          className="rounded-card border border-l-4 border-rule border-l-focus bg-paper-raised p-6"
        >
          <h2 id="support" className="m-0 mb-3 text-h3">
            Help is here
          </h2>
          <p className="m-0 whitespace-pre-line">{text(entry, "text")}</p>
        </section>
      );
    case "end":
      return (
        <Feedback kind="info" title={entry.reason === "PAUSED" ? "Paused" : "Lesson finished"}>
          <p className="m-0">
            {entry.reason === "PAUSED"
              ? "Your place is saved. Carry on whenever you like."
              : "Good place to stop. Eddy has updated your plan."}
          </p>
        </Feedback>
      );
    default:
      return null;
  }
}

export function LessonRunner({
  initial,
  preferences,
}: {
  initial: LessonOut;
  preferences: Preferences;
}) {
  const [lesson, setLesson] = useState(initial);
  const [entries, setEntries] = useState<Entry[]>(initial.outbox as Entry[]);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [message, setMessage] = useState("");
  const [timeUp, setTimeUp] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const waiting = new Set(lesson.waiting_for);

  useEffect(() => {
    const minutes = preferences.session_minutes;
    const timer = window.setTimeout(() => setTimeUp(true), minutes * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [preferences.session_minutes]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);

  function send(input: LessonInput, echo?: string) {
    startTransition(async () => {
      if (echo) setEntries((old) => [...old, { type: "student", text: echo }]);
      const result = await sendInput(lesson.session_id, input);
      if (!result.ok) {
        setError(result.error);
        // Take the echo back and return the text, so a retry does not show it twice.
        if (echo) {
          setEntries((old) => old.slice(0, -1));
          setMessage(echo);
        }
        return;
      }
      setError(undefined);
      setConfidence(null);
      setLesson(result.lesson);
      setEntries((old) => [...old, ...(result.lesson.outbox as Entry[])]);
    });
  }

  function answer(submission: AnswerSubmission) {
    if (submission.mathjson !== null) send({ kind: "answer", mathjson: submission.mathjson });
  }

  const ended = lesson.ended !== null && lesson.ended !== undefined;

  return (
    <div className="flex flex-col gap-6">
      <ol className="m-0 flex list-none flex-col gap-4 p-0" aria-label="This lesson so far">
        {entries.map((entry, index) => (
          <li key={index}>
            <OutboxEntry entry={entry} preferences={preferences} />
          </li>
        ))}
      </ol>
      <div ref={end} />
      <LiveRegion>
        {pending ? <p className="m-0 text-ink-muted">Eddy is writing</p> : null}
        {error ? (
          <Feedback kind="info" title="That did not work">
            <p className="m-0">{error}</p>
          </Feedback>
        ) : null}
        {timeUp && !ended ? (
          <Feedback kind="info" title="Good place to stop">
            <p className="m-0">
              You have been working for a while. Your place is saved if you want a break.
            </p>
          </Feedback>
        ) : null}
      </LiveRegion>

      {ended ? (
        <div className="flex flex-wrap gap-4">
          <NextLink href="/home" className={buttonClassName("accent")}>
            Back to today
          </NextLink>
          <NextLink href="/progress" className={buttonClassName("secondary")}>
            See my progress
          </NextLink>
        </div>
      ) : (
        <section aria-label="Your turn" className="flex flex-col gap-6 border-t border-rule pt-6">
          {waiting.has("answer") ? (
            <AnswerBox onSubmit={answer} busy={pending} askConfidence={false} />
          ) : null}
          {waiting.has("confidence") ? (
            <div className="flex flex-col gap-4">
              <ConfidencePicker
                legend="How sure are you?"
                value={confidence}
                onChange={setConfidence}
              />
              <div>
                <Button
                  variant="accent"
                  busy={pending}
                  onClick={() =>
                    confidence
                      ? send({ kind: "confidence", value: confidence })
                      : setError("Say how sure you are first.")
                  }
                >
                  Mark it
                </Button>
              </div>
            </div>
          ) : null}
          {waiting.has("watched") ? (
            <div>
              <Button variant="accent" busy={pending} onClick={() => send({ kind: "watched" })}>
                I have watched it
              </Button>
            </div>
          ) : null}
          {waiting.has("continue") ? (
            <div>
              <Button variant="accent" busy={pending} onClick={() => send({ kind: "continue" })}>
                Continue
              </Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-3 rounded-card border border-rule p-4">
            <h2 className="m-0 text-h4">Ask Eddy</h2>
            {waiting.has("message") ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = message.trim();
                  if (!value) return;
                  setMessage("");
                  send({ kind: "message", text: value }, value);
                }}
              >
                <label htmlFor="tutor-message" className="font-semibold">
                  Your message
                </label>
                <textarea
                  id="tutor-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={1000}
                  rows={2}
                  className="min-h-11 w-full rounded-control border border-field-border bg-paper-raised p-3 text-ink"
                />
                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit" variant="secondary" busy={pending}>
                    Send
                  </Button>
                  {waiting.has("help") ? (
                    <Button variant="quiet" busy={pending} onClick={() => send({ kind: "help" })}>
                      I am stuck: give me a hint
                    </Button>
                  ) : null}
                </div>
              </form>
            ) : null}
            <p className="m-0 text-caption text-ink-muted">
              Eddy gives hints, never just the answer.{" "}
              <NextLink href={`/concern?lesson=${lesson.session_id}`} className={linkClassName}>
                Report a concern
              </NextLink>
            </p>
          </div>
          {waiting.has("pause") ? (
            <div>
              <Button variant="quiet" busy={pending} onClick={() => send({ kind: "pause" })}>
                Stop for now
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
