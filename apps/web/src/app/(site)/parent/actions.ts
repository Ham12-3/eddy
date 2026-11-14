"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { maySignIn, signIn, signOut } from "@/auth";
import type { FormState } from "@/components/forms";
import { apiClientFor } from "@/lib/api";
import { AUTH_CALLER } from "@/lib/auth-adapter";
import { PRIVACY_NOTICE_VERSION } from "@/lib/notices";
import { requireParent } from "@/lib/session";
import { visitorKey } from "@/lib/visitor";

const codeSchema = z.string().trim().min(4).max(32);
const emailSchema = z.email().max(320);

/** A parent with a child's code asks for a sign-up link (ADR-0033). */
export async function joinAsParent(_: FormState, form: FormData): Promise<FormState> {
  const code = codeSchema.safeParse(form.get("code"));
  const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  const fields: Record<string, string> = {};
  if (!code.success) fields.code = "Enter the code your child gave you.";
  if (!email.success) fields.email = "Enter an email address, like name@example.com.";
  if (form.get("adult") !== "on") fields.adult = "Confirm you are their parent or carer.";
  if (!code.success || !email.success || fields.adult) return { fields };
  const address = email.data.toLowerCase();
  const api = await apiClientFor(AUTH_CALLER);
  const { response } = await api.POST("/v1/auth/parent-signups", {
    body: { email: address, code: code.data, adult_confirmed: true, visitor: await visitorKey() },
  });
  if (response.status === 429) return { error: "That was a lot of tries. Wait a minute." };
  if (response.status === 409) {
    return { fields: { code: "That code does not work. Ask your child for a new one." } };
  }
  if (!response.ok) return { error: "Eddy could not send a link just now. Try again soon." };
  if (await maySignIn(address)) {
    await signIn("nodemailer", { email: address, redirect: false, redirectTo: "/parent" });
  }
  redirect("/check-your-email");
}

/** A signed-in parent adds another child's code. */
export async function addChild(_: FormState, form: FormData): Promise<FormState> {
  const { api } = await requireParent();
  const code = codeSchema.safeParse(form.get("code"));
  if (!code.success) return { fields: { code: "Enter the code your child gave you." } };
  const { response } = await api.POST("/v1/parent/links", { body: { code: code.data } });
  if (response.status === 404) {
    return { fields: { code: "That code does not work. Ask your child for a new one." } };
  }
  if (response.status === 429) return { error: "That was a lot of tries. Wait a minute." };
  if (!response.ok) return { error: "Eddy could not add that just now. Try again soon." };
  revalidatePath("/parent");
  return { fields: { sent: "Sent. Your child needs to accept before you see anything." } };
}

export async function endAsParent(linkId: string): Promise<void> {
  const { api } = await requireParent();
  await api.POST("/v1/parent/links/{link_id}/end", { params: { path: { link_id: linkId } } });
  revalidatePath("/parent");
  redirect("/parent");
}

export async function acknowledgeParentNotice(): Promise<void> {
  const { api } = await requireParent();
  await api.POST("/v1/parent/notices", { body: { version: PRIVACY_NOTICE_VERSION } });
  revalidatePath("/parent/account");
}

export async function deleteParentAccount(_: FormState, form: FormData): Promise<FormState> {
  if (form.get("confirm") !== "DELETE") {
    return { fields: { confirm: "Type DELETE in capitals to confirm." } };
  }
  const { api } = await requireParent();
  const { response } = await api.POST("/v1/parent/delete", { body: { confirm: true } });
  if (!response.ok) return { error: "Eddy could not take that request just now. Try again soon." };
  await signOut({ redirect: false });
  redirect("/deleted");
}
