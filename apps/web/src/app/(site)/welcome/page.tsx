import { redirect } from "next/navigation";

import { onboardingStep, requireStudent } from "@/lib/session";

/** Where a student lands after signing in: the next onboarding step, or today's plan. */
export default async function WelcomePage() {
  const { me } = await requireStudent({ onboarding: true });
  redirect(onboardingStep(me) ?? "/home");
}
