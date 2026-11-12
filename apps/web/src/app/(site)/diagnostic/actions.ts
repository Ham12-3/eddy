"use server";

import type { components } from "@eddy/api-client";
import type { MathJson } from "@eddy/ui";

import { requireStudent } from "@/lib/session";

export type RevealOut = components["schemas"]["RevealOut"];

export type AnswerResult = { ok: true; reveal: RevealOut } | { ok: false; error: string };

export async function answerDiagnostic(
  diagnosticId: string,
  itemId: string,
  answer: { mathjson: MathJson | null; confidence: number; dontKnow: boolean },
): Promise<AnswerResult> {
  const { api } = await requireStudent();
  const { data, error, response } = await api.POST("/v1/diagnostic/{diagnostic_id}/answer", {
    params: { path: { diagnostic_id: diagnosticId } },
    body: {
      item_id: itemId,
      mathjson: answer.mathjson,
      confidence: answer.confidence,
      dont_know: answer.dontKnow,
    },
  });
  if (data) return { ok: true, reveal: data };
  if (response.status === 422) {
    const detail = (error as { detail?: unknown } | undefined)?.detail;
    return {
      ok: false,
      error: typeof detail === "string" ? detail : "Eddy could not read that answer.",
    };
  }
  if (response.status === 409) {
    return { ok: false, error: "That question was already answered. Reload the page." };
  }
  return { ok: false, error: "Eddy could not check that just now. Try again in a moment." };
}
