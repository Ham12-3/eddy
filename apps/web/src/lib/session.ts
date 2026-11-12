/**
 * The signed-in student, for server components and actions.
 *
 * `auth()` reads the session through the adapter (services/api), so a deactivated account is
 * signed out at once. Calls for a student carry a 60-second token with their account id as the
 * subject and the role `student` (ADR-0018).
 */
import "server-only";

import type { ApiClient, components } from "@eddy/api-client";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";

import { apiClientFor } from "./api";
import { PRIVACY_NOTICE_VERSION } from "./notices";

export type Me = components["schemas"]["MeOut"];
export type Preferences = components["schemas"]["Preferences"];

export interface SignedIn {
  id: string;
  role: string;
}

export const currentUser = cache(async (): Promise<SignedIn | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.role) return null;
  return { id: user.id, role: user.role };
});

export async function studentApi(user: SignedIn): Promise<ApiClient> {
  return apiClientFor({ subject: user.id, role: "student" });
}

/** The signed-in student's account, or null when signed out or not a student. */
export const currentStudent = cache(async (): Promise<{ user: SignedIn; me: Me } | null> => {
  const user = await currentUser();
  if (!user || user.role !== "student") return null;
  const api = await studentApi(user);
  const { data } = await api.GET("/v1/me");
  return data ? { user, me: data } : null;
});

/**
 * For the layout and header: the signed-in student, or null, never an error. A public page must
 * still render when the API is down or no session secret is configured.
 */
export async function signedInStudent(): Promise<{ user: SignedIn; me: Me } | null> {
  try {
    return await currentStudent();
  } catch {
    return null;
  }
}

/** What a student must do before learning, in order, or null when they are ready. */
export function onboardingStep(me: Me): "/welcome/privacy" | "/welcome/set-up" | null {
  const acknowledged = me.notices.some(
    (notice) => notice.notice_key === "privacy" && notice.version === PRIVACY_NOTICE_VERSION,
  );
  if (!acknowledged) return "/welcome/privacy";
  if (!me.profile.setup_completed_at) return "/welcome/set-up";
  return null;
}

/**
 * For pages a signed-in student uses: sends anyone else to sign in, and a student who has not
 * acknowledged the privacy notice or set up yet to that step first.
 */
export async function requireStudent(options: { onboarding?: boolean } = {}): Promise<{
  user: SignedIn;
  me: Me;
  api: ApiClient;
}> {
  const current = await currentStudent();
  if (!current) {
    const user = await currentUser();
    redirect(user?.role === "parent" ? "/parent" : "/sign-in");
  }
  if (!options.onboarding) {
    const step = onboardingStep(current.me);
    if (step) redirect(step);
  }
  return { ...current, api: await studentApi(current.user) };
}

/** For a parent's pages (ADR-0033): anyone else is sent to sign in, or to their own pages. */
export async function requireParent(): Promise<{ user: SignedIn; api: ApiClient }> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.role !== "parent") redirect("/welcome");
  return { user, api: await apiClientFor({ subject: user.id, role: "parent" }) };
}

/** Who is signed in, for the header: never an error on a public page. */
export async function signedInRole(): Promise<string | null> {
  try {
    return (await currentUser())?.role ?? null;
  } catch {
    return null;
  }
}
