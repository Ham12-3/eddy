import { Button } from "@eddy/ui";

import { signOut } from "@/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button type="submit" variant="quiet" className="px-0!">
        Sign out
      </Button>
    </form>
  );
}
