// Shared auth-screen frame (login / signup / reset / update): full-bleed two-column
// split — white form panel (1/3) with the DEKSIA wordmark, homepage loop video under
// the indigo brand gradient filling the rest. Video column collapses on mobile.
export default function AuthShell({ children }) {
  return (
    <main style={{ display: "flex", minHeight: "100vh", maxWidth: "none", margin: 0, padding: 0 }}>
      <div style={{ flex: "0 0 33.333%", minWidth: 380, maxWidth: "100vw", display: "flex", flexDirection: "column",
        justifyContent: "center", padding: "48px min(6vw, 84px)", background: "#fff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/deksia-logo.svg" alt="DEKSIA" style={{ height: 30, width: "auto", display: "block", alignSelf: "flex-start" }} />
        {children}
      </div>

      <div className="login-video" style={{ flex: 1, position: "relative", minWidth: 0, background: "#0b0d10" }}>
        <video autoPlay muted loop playsInline preload="auto" aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}>
          <source src="https://deksia.com/hubfs/Website%20Homepage%20Loop%20v2.mp4" type="video/mp4" />
        </video>
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
