"use server";

import type { components } from "@eddy/api-client";
import type { MathJson } from "@eddy/ui";
import { redirect } from "next/navigation";

import { requireStudent } from "@/lib/session";

export type LessonOut = components["schemas"]["LessonOut"];
export type LessonInput =
  | { kind: "continue" | "help" | "watched" | "pause" }
  | { kind: "answer"; mathjson: MathJson }
  | { kind: "confidence"; value: number }
  | { kind: "message"; text: string };

export type InputResult = { ok: true; lesson: LessonOut } | { ok: false; error: string };

export async function startLesson(node?: string): Promise<void> {
  const { api } = await requireStudent();
  const { data } = await api.POST("/v1/tutor/sessions", { body: node ? { node } : {} });
  if (!data) redirect("/home?problem=start");
  redirect(`/learn/${data.session_id}`);
}

export async function sendInput(sessionId: string, input: LessonInput): Promise<InputResult> {
  const { api } = await requireStudent();
  const { data, response, error } = await api.POST("/v1/tutor/sessions/{session_id}/input", {
    params: { path: { session_id: sessionId } },
    body: input,
  });
  if (data) return { ok: true, lesson: data };
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  if (response.status === 429) {
    return {
      ok: false,
      error: "That is a lot of messages. Take a breath and try again in a minute.",
    };
  }
  if (typeof detail === "string" && response.status < 500) return { ok: false, error: detail };
  return { ok: false, error: "Eddy could not reply just now. Try again in a moment." };
}
