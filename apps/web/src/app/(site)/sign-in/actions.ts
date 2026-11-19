"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { maySignIn, signIn } from "@/auth";
import type { FormState } from "@/components/forms";

const emailSchema = z.email().max(320);

/**
 * Sends a link only to an account or a pending sign-up, and shows the same page either way, so
 * this form cannot be used to find out who has an account.
 */
export async function sendSignInLink(_: FormState, form: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success)
    return { fields: { email: "Enter an email address, like name@example.com." } };
  const email = parsed.data.toLowerCase();
  if (await maySignIn(email)) {
    await signIn("nodemailer", { email, redirect: false, redirectTo: "/welcome" });
  }
  redirect("/check-your-email");
}
