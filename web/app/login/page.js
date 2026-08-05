import { login } from "./actions";
import AuthShell from "../_components/AuthShell";

export default function LoginPage({ searchParams }) {
  const error = searchParams?.error;
  return (
    <AuthShell>
      <p className="muted" style={{ margin: "18px 0 8px", fontSize: 13.5 }}>
        Client performance console. Sign in to continue.
      </p>
      <form action={login}>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label style={{ display: "block", marginTop: 12 }}>Password
          <input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit" style={{ width: "100%", padding: "12px 14px" }}>Sign in</button>
      </form>
      {error ? <div className="err">Sign-in failed — check your email and password.</div> : null}
      <p className="muted" style={{ marginTop: 18, display: "flex", gap: 16, fontSize: 12.5, flexWrap: "wrap" }}>
        <a href="/reset">Forgot password?</a>
        <a href="/signup">Create account (@deksia.com)</a>
      </p>
    </AuthShell>
  );
}
