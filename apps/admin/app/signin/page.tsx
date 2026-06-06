import { createAdminSession, validateAdminCredentials } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function SignInPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as { error?: string };

  async function signIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    if (!validateAdminCredentials(email, password)) {
      redirect("/signin?error=1");
    }
    await createAdminSession();
    redirect("/");
  }

  return (
    <main className="signinPage">
      <div className="signinCard">
        <div className="signinBrand">⚡ FixFinder</div>
        <p className="signinSub">Sign in to the admin console</p>

        <form action={signIn} className="form">
          <label className="formLabel">
            Email
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label className="formLabel">
            Password
            <input name="password" type="password" required autoComplete="current-password" />
          </label>

          {params.error && (
            <div className="alertError">Invalid credentials. Please try again.</div>
          )}

          <button type="submit" className="btnPrimary" style={{ marginTop: "0.25rem" }}>
            Sign in
          </button>
        </form>

        <p className="textSm textMuted" style={{ marginTop: "1.25rem" }}>
          Use the <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> from your environment.
        </p>
      </div>
    </main>
  );
}
