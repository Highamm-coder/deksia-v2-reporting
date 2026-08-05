import { login } from "./actions";

// deksia.com-style login — full-bleed two-column split: white form panel on the
// left, the homepage loop video filling the right. Video is hotlinked from the
// site's CDN so brand refreshes propagate; the panel stands alone on mobile.
export default function LoginPage({ searchParams }) {
  const error = searchParams?.error;
  return (
    <main style={{ display: "flex", minHeight: "100vh", maxWidth: "none", margin: 0, padding: 0 }}>
      {/* left: form panel */}
      <div style={{ flex: "0 0 33.333%", minWidth: 380, maxWidth: "100vw", display: "flex", flexDirection: "column",
        justifyContent: "center", padding: "48px min(6vw, 84px)", background: "#fff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/deksia-logo.svg" alt="DEKSIA" style={{ height: 30, width: "auto", display: "block", alignSelf: "flex-start" }} />
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
      </div>

      {/* right: full-bleed brand video under an indigo gradient wash */}
      <div className="login-video" style={{ flex: 1, position: "relative", minWidth: 0, background: "#0b0d10" }}>
        <video autoPlay muted loop playsInline preload="auto" aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}>
          <source src="https://deksia.com/hubfs/Website%20Homepage%20Loop%20v2.mp4" type="video/mp4" />
        </video>
        {/* brand gradient overlay: periwinkle bloom upper-middle, indigo field,
            near-black lower-left, magenta hint bottom-right */}
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, mixBlendMode: "multiply", opacity: 0.88,
          background: `
            radial-gradient(60% 42% at 55% 28%, rgba(133,172,247,.95) 0%, rgba(133,172,247,0) 62%),
            radial-gradient(75% 65% at 12% 82%, rgba(12,10,26,.96) 0%, rgba(12,10,26,0) 62%),
            radial-gradient(55% 50% at 96% 96%, rgba(146,44,196,.55) 0%, rgba(146,44,196,0) 60%),
            linear-gradient(158deg, #5a58ee 0%, #4f4ade 45%, #3d33b4 100%)`,
        }} />
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, mixBlendMode: "screen", opacity: 0.28,
          background: "radial-gradient(50% 36% at 55% 30%, rgba(150,185,255,.8) 0%, rgba(150,185,255,0) 65%)",
        }} />
      </div>
    </main>
  );
}
