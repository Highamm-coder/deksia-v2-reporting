import { login } from "./actions";

export default function LoginPage({ searchParams }) {
  const error = searchParams?.error;
  return (
    <main>
      <div className="card" style={{ marginTop: "10vh" }}>
        <h1 style={{ marginTop: 0 }}>Deksia Console</h1>
        <p className="muted" style={{ marginTop: 0 }}>Sign in to continue.</p>
        <form action={login}>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label style={{ display: "block", marginTop: 10 }}>Password
            <input name="password" type="password" autoComplete="current-password" required /></label>
          <button type="submit">Sign in</button>
        </form>
        {error ? <div className="err">Sign-in failed — check your email and password.</div> : null}
      </div>
    </main>
  );
}
