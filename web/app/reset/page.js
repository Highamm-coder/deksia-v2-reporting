import { requestReset } from "./actions";

export default function ResetPage({ searchParams }) {
  const sent = searchParams?.sent;
  return (
    <main>
      <div className="card" style={{ marginTop: "10vh" }}>
        <h1 style={{ marginTop: 0 }}>Reset password</h1>
        {sent ? (
          <p>If that account exists, a reset link is on its way. Open it on this device to set a new password.</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>We&apos;ll email you a reset link.</p>
            <form action={requestReset}>
              <label>Email<input name="email" type="email" autoComplete="email" required /></label>
              <button type="submit">Send reset link</button>
            </form>
          </>
        )}
        <p className="muted" style={{ marginTop: 14 }}><a href="/login">← Back to sign in</a></p>
      </div>
    </main>
  );
}
