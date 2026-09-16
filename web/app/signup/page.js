import { signup } from "./actions";
import AuthShell from "../_components/AuthShell";

const ERRORS = {
  domain: "Sign-ups are limited to @deksia.com email addresses.",
  weak: "Password must be at least 8 characters.",
  1: "Could not create the account — it may already exist. Try signing in or resetting your password.",
};

export default function SignupPage({ searchParams }) {
  const error = searchParams?.error;
  const sent = searchParams?.sent;
  return (
    <AuthShell>
      <h1 style={{ margin: "18px 0 2px", fontSize: 22 }}>Create account</h1>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13.5 }}>Deksia team members only (@deksia.com).</p>
      {sent ? (
        <p>Check your <strong>@deksia.com</strong> inbox for a confirmation link, then sign in.</p>
      ) : (
        <form action={signup}>
          <label>Work email<input name="email" type="email" placeholder="you@deksia.com" autoComplete="email" required /></label>
          <label style={{ display: "block", marginTop: 12 }}>Password
            <input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
          <button type="submit" style={{ width: "100%", padding: "12px 14px" }}>Sign up</button>
        </form>
      )}
      {error ? <div className="err">{ERRORS[error] || ERRORS[1]}</div> : null}
      <p className="muted" style={{ marginTop: 18, fontSize: 12.5 }}><a href="/login">← Back to sign in</a></p>
    </AuthShell>
  );
}
