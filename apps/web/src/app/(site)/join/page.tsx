import type { Metadata } from "next";

import { Page } from "@/components/Page";

import { InviteForm } from "./JoinForms";

export const metadata: Metadata = { title: "Join" };

export default function JoinPage() {
  return (
    <Page
      title="Join Eddy"
      lead="Eddy is in a closed trial. Enter the invite code from your school or the person who invited you."
    >
      <InviteForm />
    </Page>
  );
}
