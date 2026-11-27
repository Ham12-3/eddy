"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { signOut } from "@/auth";
import type { FormState } from "@/components/forms";
import { isLocalMode } from "@/lib/local-mode";
import { clearProfile } from "@/lib/local-profile";
import { requireStudent } from "@/lib/session";

const preferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  narration_speed: z.coerce
    .number()
    .pipe(z.union([z.literal(0.75), z.literal(1), z.literal(1.25)])),
  session_minutes: z.coerce.number().int().min(10).max(60),
});

export async function savePreferences(_: FormState, form: FormData): Promise<FormState> {
  const { api } = await requireStudent({ onboarding: true });
  const parsed = preferencesSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check your choices and try again." };
  const { response } = await api.PUT("/v1/me/preferences", {
    body: {
      ...parsed.data,
      reading: form.get("dyslexia") === "on" ? "dyslexia" : "standard",
      motion: form.get("reduce_motion") === "on" ? "reduce" : "system",
      captions_only: form.get("captions_only") === "on",
    },
  });
  if (!response.ok) return { error: "Eddy could not save that just now. Try again in a moment." };
  revalidatePath("/", "layout");
  return { error: undefined, fields: { saved: "Saved." } };
}

export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  if (form.get("confirm") !== "DELETE") {
    return { fields: { confirm: "Type DELETE in capitals to confirm." } };
  }
  const { api } = await requireStudent({ onboarding: true });
  const { response } = await api.POST("/v1/me/data-requests", {
    body: { kind: "DELETE", confirm: true },
  });
  if (!response.ok) return { error: "Eddy could not take that request just now. Try again soon." };
  if (isLocalMode()) await clearProfile();
  else await signOut({ redirect: false });
  redirect("/deleted");
}

export interface CodeState {
  code?: string;
  expires?: string;
  error?: string;
}

/** A new parent link code, shown once (ADR-0033). */
export async function makeParentCode(): Promise<CodeState> {
  if (isLocalMode()) notFound(); // no parent accounts in the desktop app (ADR-0036)
  const { api } = await requireStudent({ onboarding: true });
  const { data } = await api.POST("/v1/me/parent-links/code");
  if (!data) return { error: "Eddy could not make a code just now. Try again soon." };
  revalidatePath("/settings");
  return { code: data.code, expires: data.expires_at };
}

const sharingSchema = z.object({
  on: z.enum(["true", "false"]).transform((value) => value === "true"),
  pin: z.union([z.literal(""), z.string().regex(/^[0-9]{4,8}$/)]),
});

/**
 * Switches the progress summary for people at this computer on or off (the desktop app,
 * ADR-0036). Only the student whose profile is open can, and switching on asks for the PIN of a
 * profile that has one.
 */
export async function setProgressSharing(_: FormState, form: FormData): Promise<FormState> {
  if (!isLocalMode()) notFound();
  const { api } = await requireStudent({ onboarding: true });
  const parsed = sharingSchema.safeParse({
    on: form.get("on"),
    pin: String(form.get("pin") ?? ""),
  });
  if (!parsed.success) {
    return { error: "That PIN did not work.", fields: { pin: "A PIN is 4 to 8 digits." } };
  }
  const { on, pin } = parsed.data;
  const { response } = await api.PUT("/v1/local/me/parent-view", {
    body: { on, pin: on && pin ? pin : null },
  });
  if (response.status === 403) {
    return {
      error: "Eddy needs your PIN to share your progress.",
      fields: { pin: pin ? "That PIN is not right. Try again." : "Type your PIN." },
    };
  }
  if (response.status === 429) {
    return { error: "Too many wrong tries. Wait a while, then try again." };
  }
  if (response.status === 409) {
    return { error: "Read the privacy notice first. It says what sharing means." };
  }
  if (!response.ok) return { error: "Eddy could not change that just now. Try again in a moment." };
  // The header's note that progress is shared lives in the layout.
  revalidatePath("/", "layout");
  return {};
}

export async function answerParentLink(linkId: string, accept: boolean): Promise<string | null> {
  if (isLocalMode()) notFound();
  const { api } = await requireStudent({ onboarding: true });
  const params = { params: { path: { link_id: linkId } } };
  const { response } = accept
    ? await api.POST("/v1/me/parent-links/{link_id}/accept", params)
    : await api.POST("/v1/me/parent-links/{link_id}/end", params);
  if (!response.ok) return "That did not work. Try again in a moment.";
  // The header's "your parent can see your progress" note lives in the layout.
  revalidatePath("/", "layout");
  return null;
}
