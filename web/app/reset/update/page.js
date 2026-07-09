import { updatePassword } from "../actions";

const ERRORS = {
  weak: "Password must be at least 8 characters.",
  match: "Passwords don't match.",
  1: "Could not update the password — the reset link may have expired. Request a new one.",
};

export default function UpdatePasswordPage({ searchParams }) {
  const error = searchParams?.error;
  return (
    <main>
      <div className="card" style={{ marginTop: "10vh" }}>
        <h1 style={{ marginTop: 0 }}>Set a new password</h1>
        <form action={updatePassword}>
          <label>New password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
          <label style={{ display: "block", marginTop: 10 }}>Confirm
            <input name="confirm" type="password" minLength={8} autoComplete="new-password" required /></label>
          <button type="submit">Update password</button>
        </form>
        {error ? <div className="err">{ERRORS[error] || ERRORS[1]}</div> : null}
      </div>
    </main>
  );
}
