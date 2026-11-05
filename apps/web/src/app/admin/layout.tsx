import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdminPreview } from "@/lib/admin-gate";

export const metadata: Metadata = {
  title: "Eddy admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  requireAdminPreview();
  return (
    <main className="min-h-screen max-w-[72rem] px-4 py-8 md:ml-[6vw] md:border-l md:border-rule md:px-8 md:py-12">
      <p className="m-0 mb-6 text-caption text-ink-muted">
        Admin preview. Read only, and local only until sign-in arrives.
      </p>
      {children}
    </main>
  );
}
