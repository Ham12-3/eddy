"use server";

import { z } from "zod";

import type { FormState } from "@/components/forms";
import { requireStudent } from "@/lib/session";

const concernSchema = z.object({
  category: z.enum(["SAFETY", "CONTENT", "PRIVACY", "OTHER"]),
  message: z.string().trim().min(1).max(2000),
  lesson: z.uuid().optional().or(z.literal("")),
});

export async function reportConcern(_: FormState, form: FormData): Promise<FormState> {
  const { api } = await requireStudent();
  const parsed = concernSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { fields: { message: "Choose what it is about and tell us what happened." } };
  }
  const { category, message, lesson } = parsed.data;
  const { response } = await api.POST("/v1/me/concerns", {
    body: {
      category,
      message,
      page: lesson ? "/learn" : "/concern",
      tutor_session_id: lesson || null,
    },
  });
  if (response.status === 429) {
    return { error: "You have sent a lot of reports today. If you are in danger, call 999." };
  }
  if (!response.ok) return { error: "Your report did not send. Try again in a moment." };
  return { fields: { sent: "yes" } };
}
