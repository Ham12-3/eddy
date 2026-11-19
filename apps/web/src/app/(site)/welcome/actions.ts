"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/forms";
import { PRIVACY_NOTICE_VERSION } from "@/lib/notices";
import { requireStudent } from "@/lib/session";

export async function acknowledgePrivacy(): Promise<FormState> {
  const { api } = await requireStudent({ onboarding: true });
  const { response } = await api.POST("/v1/me/notices", {
    body: { notice_key: "privacy", version: PRIVACY_NOTICE_VERSION },
  });
  if (!response.ok) return { error: "Eddy could not save that just now. Try again in a moment." };
  redirect("/welcome");
}

const setupSchema = z.object({
  board: z.enum(["AQA", "EDEXCEL", "OCR"]),
  exam_series: z.string().regex(/^20\d{2}-(summer|november)$/),
  target_grade: z.coerce.number().pipe(z.union([z.literal(4), z.literal(5)])),
  is_resitter: z.enum(["yes", "no"]).transform((value) => value === "yes"),
  theme: z.enum(["system", "light", "dark"]),
  narration_speed: z.coerce
    .number()
    .pipe(z.union([z.literal(0.75), z.literal(1), z.literal(1.25)])),
});

const FIELD_ERRORS: Record<string, string> = {
  board: "Choose your exam board.",
  exam_series: "Choose when you take your exams.",
  target_grade: "Choose the grade you are aiming for.",
  is_resitter: "Say whether you are resitting.",
  theme: "Choose how Eddy should look.",
  narration_speed: "Choose a narration speed.",
};

export async function saveSetUp(_: FormState, form: FormData): Promise<FormState> {
  const { api, me } = await requireStudent({ onboarding: true });
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (FIELD_ERRORS[key]) fields[key] = FIELD_ERRORS[key];
    }
    return { error: "A few answers are missing.", fields };
  }
  const value = parsed.data;
  const profile = await api.PUT("/v1/me/profile", {
    body: {
      board: value.board,
      tier: "FOUNDATION",
      exam_series: value.exam_series,
      target_grade: value.target_grade,
      is_resitter: value.is_resitter,
    },
  });
  const preferences = await api.PUT("/v1/me/preferences", {
    body: {
      theme: value.theme,
      reading: form.get("dyslexia") === "on" ? "dyslexia" : "standard",
      motion: form.get("reduce_motion") === "on" ? "reduce" : "system",
      captions_only: form.get("captions_only") === "on",
      narration_speed: value.narration_speed,
      session_minutes: me.preferences.session_minutes,
    },
  });
  if (!profile.response.ok || !preferences.response.ok) {
    return { error: "Eddy could not save your answers just now. Try again in a moment." };
  }
  redirect("/diagnostic");
}
