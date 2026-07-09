import { signup } from "./actions";

const ERRORS = {
  domain: "Sign-ups are limited to @deksia.com email addresses.",
  weak: "Password must be at least 8 characters.",
  1: "Could not create the account — it may already exist. Try signing in or resetting your password.",
};

export default function SignupPage({ searchParams }) {
  const error = searchParams?.error;
  const sent = searchParams?.sent;
  return (
    <main>
      <div className="card" style={{ marginTop: "10vh" }}>
        <h1 style={{ marginTop: 0 }}>Create account</h1>
        <p className="muted" style={{ marginTop: 0 }}>Deksia team members only (@deksia.com).</p>
        {sent ? (
          <p>Check your <strong>@deksia.com</strong> inbox for a confirmation link, then sign in.</p>
        ) : (
          <form action={signup}>
            <label>Work email<input name="email" type="email" placeholder="you@deksia.com" autoComplete="email" required /></label>
            <label style={{ display: "block", marginTop: 10 }}>Password
              <input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
            <button type="submit">Sign up</button>
          </form>
        )}
        {error ? <div className="err">{ERRORS[error] || ERRORS[1]}</div> : null}
        <p className="muted" style={{ marginTop: 14 }}><a href="/login">← Back to sign in</a></p>
      </div>
    </main>
  );
}
