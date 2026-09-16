import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";
import { updatePassword } from "../reset/actions";

export const dynamic = "force-dynamic";

const ERRORS = {
  weak: "Password must be at least 8 characters.",
  match: "Passwords don't match.",
  1: "Could not update the password. Try again.",
};

export default async function AccountPage({ searchParams }) {
  const supabase = getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const error = searchParams?.error;
  const ok = searchParams?.ok;

  return (
    <AppShell>
        <h2>Account</h2>
        <div className="card">
          <p style={{ marginTop: 0 }}><span className="muted">Signed in as</span><br /><strong>{user?.email}</strong></p>
          <p className="muted" style={{ fontSize: 12 }}>
            Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString() : "—"} ·
            last sign-in {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "—"}
          </p>
        </div>

        <h2>Change password</h2>
        <div className="card">
          <form action={updatePassword}>
            <input type="hidden" name="from" value="account" />
            <label>New password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
            <label style={{ display: "block", marginTop: 10 }}>Confirm
              <input name="confirm" type="password" minLength={8} autoComplete="new-password" required /></label>
            <button type="submit">Update password</button>
          </form>
          {error ? <div className="err">{ERRORS[error] || ERRORS[1]}</div> : null}
          {ok ? <p style={{ color: "var(--on)", marginBottom: 0 }}>Password updated.</p> : null}
        </div>

        <h2>Team access</h2>
        <p className="muted">
          Anyone with an <strong>@deksia.com</strong> email can self-serve an account at{" "}
          <a href="/signup">/signup</a> (confirmation email required). Other domains are blocked at the
          database level. Forgotten password? <a href="/reset">/reset</a> emails a recovery link.
        </p>
    </AppShell>
  );
}
