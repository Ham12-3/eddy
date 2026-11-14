import { redirect } from "next/navigation";

import { currentUser, onboardingStep, requireStudent } from "@/lib/session";

/** Where someone lands after signing in: a parent's page, or a student's next step or today. */
export default async function WelcomePage() {
  if ((await currentUser())?.role === "parent") redirect("/parent");
  const { me } = await requireStudent({ onboarding: true });
  redirect(onboardingStep(me) ?? "/home");
}
