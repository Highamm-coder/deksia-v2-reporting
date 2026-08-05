import { requestReset } from "./actions";
import AuthShell from "../_components/AuthShell";

export default function ResetPage({ searchParams }) {
  const sent = searchParams?.sent;
  return (
    <AuthShell>
      <h1 style={{ margin: "18px 0 2px", fontSize: 22 }}>Reset password</h1>
      {sent ? (
        <p>If that account exists, a reset link is on its way. Open it on this device to set a new password.</p>
      ) : (
        <>
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 13.5 }}>We&apos;ll email you a reset link.</p>
          <form action={requestReset}>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <button type="submit" style={{ width: "100%", padding: "12px 14px" }}>Send reset link</button>
          </form>
        </>
      )}
      <p className="muted" style={{ marginTop: 18, fontSize: 12.5 }}><a href="/login">← Back to sign in</a></p>
    </AuthShell>
  );
}
