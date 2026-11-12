import "@eddy/ui/assets";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { signedInStudent } from "@/lib/session";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Eddy", template: "%s | Eddy" },
  description: "A GCSE Maths tutor that explains your mistakes with short animations.",
};

/**
 * A signed-in student's display choices go on <html> before anything paints: theme, dyslexia
 * reading mode and reduced motion (packages/ui handles each attribute). Everyone else follows
 * their device's settings.
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const preferences = (await signedInStudent())?.me.preferences;
  return (
    <html
      lang="en-GB"
      data-theme={preferences && preferences.theme !== "system" ? preferences.theme : undefined}
      data-reading={preferences?.reading === "dyslexia" ? "dyslexia" : undefined}
      data-motion={preferences?.motion === "reduce" ? "reduce" : undefined}
    >
      <body>{children}</body>
    </html>
  );
}
