"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { maySignIn, signIn } from "@/auth";
import type { FormState } from "@/components/forms";
import { apiClientFor } from "@/lib/api";
import { AUTH_CALLER } from "@/lib/auth-adapter";
import {
  ageOn,
  clearJoin,
  MINIMUM_AGE,
  readJoin,
  stopForAge,
  stoppedByAge,
  writeJoin,
} from "@/lib/join";
import { visitorKey } from "@/lib/visitor";

const TOO_MANY = "That was a lot of tries. Wait a minute, then try again.";

export async function checkInvite(_: FormState, form: FormData): Promise<FormState> {
  // The under-13 stop holds for the actions too, not just the pages (SPEC.md section 4.1).
  if (await stoppedByAge()) redirect("/join/stop");
  const code = String(form.get("code") ?? "").trim();
  if (!code) return { fields: { code: "Enter the invite code you were given." } };
  if (code.length > 64) return { fields: { code: "That code is too long. Check and try again." } };
  const api = await apiClientFor(AUTH_CALLER);
  const { data, response } = await api.POST("/v1/auth/invites/check", {
    body: { code, visitor: await visitorKey() },
  });
  if (response.status === 429) return { error: TOO_MANY };
  if (!data) return { error: "Eddy could not check that code just now. Try again in a moment." };
  if (!data.valid) {
    return {
      fields: {
        code: "That code does not work. It may be mistyped, used up or out of date.",
      },
    };
  }
  await writeJoin({ invite: code });
  redirect("/join/age");
}

const ageSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1900).max(2100),
});

export async function checkAge(_: FormState, form: FormData): Promise<FormState> {
  // The under-13 stop holds for the actions too, not just the pages (SPEC.md section 4.1).
  if (await stoppedByAge()) redirect("/join/stop");
  const join = await readJoin();
  if (!join) redirect("/join");
  const parsed = ageSchema.safeParse({ month: form.get("month"), year: form.get("year") });
  if (!parsed.success) return { error: "Choose the month and year you were born." };
  const { month, year } = parsed.data;
  const age = ageOn(new Date(), year, month);
  if (age > 120) return { error: "Check the year you were born." };
  if (age < MINIMUM_AGE) {
    // Nothing is stored: only a short-lived cookie that stops an immediate retry.
    await stopForAge();
    redirect("/join/stop");
  }
  await writeJoin({ invite: join.invite, birthYear: year, birthMonth: month });
  redirect("/join/email");
}

const emailSchema = z.email().max(320);

export async function sendSignUpLink(_: FormState, form: FormData): Promise<FormState> {
  // The under-13 stop holds for the actions too, not just the pages (SPEC.md section 4.1).
  if (await stoppedByAge()) redirect("/join/stop");
  const join = await readJoin();
  if (!join?.birthYear || !join.birthMonth) redirect("/join");
  const parsed = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success)
    return { fields: { email: "Enter an email address, like name@example.com." } };
  const email = parsed.data.toLowerCase();
  const api = await apiClientFor(AUTH_CALLER);
  const { response } = await api.POST("/v1/auth/signups", {
    body: {
      email,
      invite_code: join.invite,
      birth_year: join.birthYear,
      birth_month: join.birthMonth,
      visitor: await visitorKey(),
    },
  });
  if (response.status === 429) return { error: TOO_MANY };
  if (response.status === 409) {
    await clearJoin();
    return { error: "That invite code has just been used up. Ask for a new one." };
  }
  if (!response.ok) return { error: "Eddy could not send a link just now. Try again in a moment." };
  await clearJoin();
  if (await maySignIn(email)) {
    await signIn("nodemailer", { email, redirect: false, redirectTo: "/welcome" });
  }
  redirect("/check-your-email");
}
