import { Button } from "@eddy/ui";

import { switchProfile } from "@/app/(site)/profiles/actions";
import { signOut } from "@/auth";

/** Sign out online. In the desktop app, go back to the profile picker instead (ADR-0036). */
export function SignOutButton({ local = false }: { local?: boolean }) {
  return (
    <form
      action={
        local
          ? switchProfile
          : async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }
      }
    >
      <Button type="submit" variant="quiet" className="px-0!">
        {local ? "Switch profile" : "Sign out"}
      </Button>
    </form>
  );
}
