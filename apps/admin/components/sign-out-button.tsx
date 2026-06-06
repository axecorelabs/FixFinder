import { clearAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export function SignOutButton() {
  async function signOut() {
    "use server";
    await clearAdminSession();
    redirect("/signin");
  }

  return (
    <form action={signOut}>
      <button type="submit" className="btnSecondary">
        Sign out
      </button>
    </form>
  );
}
