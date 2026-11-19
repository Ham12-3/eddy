"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signOut } from "@/auth";
import type { FormState } from "@/components/forms";
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

export async function requestExport(): Promise<FormState> {
  const { api } = await requireStudent({ onboarding: true });
  const { response } = await api.POST("/v1/me/data-requests", {
    body: { kind: "EXPORT", confirm: false },
  });
  if (!response.ok) return { error: "Eddy could not take that request just now. Try again soon." };
  revalidatePath("/settings");
  return { fields: { saved: "Request received." } };
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
  await signOut({ redirect: false });
  redirect("/deleted");
}
