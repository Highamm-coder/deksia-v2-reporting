import { login } from "./actions";

// deksia.com-style login: the homepage loop video full-bleed behind a dark wash,
// white card with the Deksia wordmark. Video is hotlinked from the site's CDN so
// brand refreshes propagate; poster/fallback is a plain dark background.
export default function LoginPage({ searchParams }) {
  const error = searchParams?.error;
  return (
    <main style={{ position: "relative", minHeight: "100vh", maxWidth: "none", margin: 0, padding: 0,
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#0b0d10" }}>
      <video autoPlay muted loop playsInline preload="auto" aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}>
        <source src="https://deksia.com/hubfs/Website%20Homepage%20Loop%20v2.mp4" type="video/mp4" />
      </video>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(8,10,14,.55)" }} />

      <div className="card" style={{ position: "relative", width: 380, maxWidth: "calc(100vw - 32px)",
        padding: "34px 34px 28px", borderRadius: 18, border: 0, boxShadow: "0 24px 80px rgba(0,0,0,.45)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/deksia-logo.svg" alt="DEKSIA" style={{ height: 26, width: "auto", display: "block" }} />
        <p className="muted" style={{ margin: "14px 0 4px", fontSize: 13 }}>Client performance console. Sign in to continue.</p>
        <form action={login}>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label style={{ display: "block", marginTop: 10 }}>Password
            <input name="password" type="password" autoComplete="current-password" required /></label>
          <button type="submit" style={{ width: "100%", padding: "11px 14px" }}>Sign in</button>
        </form>
        {error ? <div className="err">Sign-in failed — check your email and password.</div> : null}
        <p className="muted" style={{ marginTop: 16, display: "flex", gap: 14, fontSize: 12.5 }}>
          <a href="/reset">Forgot password?</a>
          <a href="/signup">Create account (@deksia.com)</a>
        </p>
      </div>
    </main>
  );
}
