"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/forms";
import { apiClientFor } from "@/lib/api";
import { ageOn, MINIMUM_AGE, stopForAge, stoppedByAge } from "@/lib/join";
import { isLocalMode } from "@/lib/local-mode";
import { clearProfile, LOCAL_CALLER, writeProfile } from "@/lib/local-profile";

const NOT_NOW = "Eddy could not do that just now. Try again in a moment.";
/** One household shares the desktop app, so the under-13 stop only blocks an immediate retry. */
const LOCAL_STOP_MINUTES = 10;

const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[^\p{Cc}<>]+$/u),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1900).max(2100),
  pin: z.union([z.literal(""), z.string().regex(/^[0-9]{4,8}$/)]),
});

/** Make a profile on this computer and open it. The age check matches the online one. */
export async function createProfile(_: FormState, form: FormData): Promise<FormState> {
  if (!isLocalMode()) notFound();
  // The under-13 stop holds for the action too, not just the page (SPEC.md section 4.1).
  if (await stoppedByAge()) redirect("/profiles/stop");
  const typed = {
    name: String(form.get("name") ?? ""),
    month: String(form.get("month") ?? ""),
    year: String(form.get("year") ?? ""),
  };
  // What comes back to the form after a problem: never the PIN.
  const values = { ...typed, name: typed.name.trim().slice(0, 24) };
  const parsed = profileSchema.safeParse({ ...typed, pin: String(form.get("pin") ?? "") });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    let birth = false;
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key === "name") fields.name = "Enter a name of up to 24 characters, without < or >.";
      if (key === "pin") fields.pin = "A PIN is 4 to 8 digits. Leave it empty for no PIN.";
      if (key === "month" || key === "year") birth = true;
    }
    // Always a form-level message too: it is the one a screen reader announces.
    const error = birth
      ? "Choose the month and year you were born."
      : "Check the answer marked below, then try again.";
    return { error, fields, values };
  }
  const { name, month, year, pin } = parsed.data;
  if (pin && String(form.get("pin_again") ?? "") !== pin) {
    return {
      error: "The two PINs are not the same.",
      fields: { pin_again: "Type the same PIN in both boxes." },
      values,
    };
  }
  const age = ageOn(new Date(), year, month);
  if (age > 120) return { error: "Check the year you were born.", values };
  if (age < MINIMUM_AGE) {
    // Nothing is stored: only a short-lived cookie that stops an immediate retry.
    await stopForAge(LOCAL_STOP_MINUTES);
    redirect("/profiles/stop");
  }
  const api = await apiClientFor(LOCAL_CALLER);
  const { data, error, response } = await api.POST("/v1/local/profiles", {
    body: { name, birth_year: year, birth_month: month, pin: pin || null },
  });
  if (response.status === 409) {
    // services/api says which it was: the name is taken, or the computer is full.
    const reason = (error as { detail?: unknown } | undefined)?.detail;
    return reason === "name_taken"
      ? {
          error: "That name is already used on this computer.",
          fields: { name: "Someone here already uses that name. Choose another." },
          values,
        }
      : {
          error:
            "This computer has as many profiles as it can hold. Delete one that is no longer used to make room.",
          values,
        };
  }
  if (!data) return { error: NOT_NOW, values };
  await writeProfile(data.id);
  redirect("/welcome");
}

const openSchema = z.object({
  id: z.uuid(),
  pin: z.union([z.literal(""), z.string().regex(/^[0-9]{4,8}$/)]),
});

/** Open a profile, with its PIN if it has one. */
export async function openProfile(_: FormState, form: FormData): Promise<FormState> {
  if (!isLocalMode()) notFound();
  const parsed = openSchema.safeParse({
    id: form.get("id"),
    pin: String(form.get("pin") ?? ""),
  });
  if (!parsed.success) {
    return { error: "That PIN did not work.", fields: { pin: "A PIN is 4 to 8 digits." } };
  }
  const { id, pin } = parsed.data;
  const api = await apiClientFor(LOCAL_CALLER);
  const { data, response } = await api.POST("/v1/local/profiles/{profile_id}/open", {
    params: { path: { profile_id: id } },
    body: { pin: pin || null },
  });
  if (response.status === 404) redirect("/profiles");
  if (response.status === 403) {
    // A profile with a PIN, opened without one, goes to the page that asks for it.
    if (!pin) redirect(`/profiles/${id}`);
    return {
      error: "That PIN did not work.",
      fields: { pin: "That PIN is not right. Try again." },
    };
  }
  if (response.status === 429) {
    return {
      error:
        "Too many wrong tries. Wait a minute, then try again. Each wrong try makes the wait longer, up to 15 minutes. Your work is safe.",
    };
  }
  if (!data) return { error: NOT_NOW };
  await writeProfile(data.id);
  redirect("/welcome");
}

/** Back to the picker: the next person chooses their own profile. */
export async function switchProfile(): Promise<void> {
  if (!isLocalMode()) notFound();
  await clearProfile();
  redirect("/profiles");
}
