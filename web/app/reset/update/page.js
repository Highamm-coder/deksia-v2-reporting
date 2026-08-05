import { updatePassword } from "../actions";
import AuthShell from "../../_components/AuthShell";

const ERRORS = {
  weak: "Password must be at least 8 characters.",
  match: "Passwords don't match.",
  1: "Could not update the password — the reset link may have expired. Request a new one.",
};

export default function UpdatePasswordPage({ searchParams }) {
  const error = searchParams?.error;
  return (
    <AuthShell>
      <h1 style={{ margin: "18px 0 8px", fontSize: 22 }}>Set a new password</h1>
      <form action={updatePassword}>
        <label>New password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
        <label style={{ display: "block", marginTop: 12 }}>Confirm
          <input name="confirm" type="password" minLength={8} autoComplete="new-password" required /></label>
        <button type="submit" style={{ width: "100%", padding: "12px 14px" }}>Update password</button>
      </form>
      {error ? <div className="err">{ERRORS[error] || ERRORS[1]}</div> : null}
    </AuthShell>
  );
}
