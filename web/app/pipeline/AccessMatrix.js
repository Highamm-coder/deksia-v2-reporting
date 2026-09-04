// Access matrix: does Deksia have read access to each client's account on each platform?
// One question per cell, answered by the nightly connection probe:
//   ● green  — an account is connected and the provider let us read it
//   ● red    — an account is connected but the provider refused (hover for its exact words)
//   –        — no account connected on this platform
// Freshness is a different question and lives in "Source freshness" below.
import Link from "next/link";

export const PLATFORMS = [
  ["meta", "Meta"], ["google_ads", "Google Ads"], ["ga4", "GA4"], ["callrail", "CallRail"], ["pages", "Pages"],
];

function Dot({ state, title }) {
  if (state === "none") return <span title={title} style={{ color: "var(--line)", fontSize: 18, lineHeight: 1 }}>–</span>;
  return (
    <span title={title} style={{
      display: "inline-block", width: 14, height: 14, borderRadius: 999,
      background: state === "ok" ? "var(--on)" : "var(--off)",
    }} />
  );
}

// Google Ads is push-based (the MCC script posts to us) so there is no API to probe; a
// mapped account is one the MCC manages, which is the access. Every other platform is
// probed nightly with the real credential, and the provider's answer decides the cell.
export function cellState(source, maps, probes) {
  if (!maps.length) return { state: "none", title: "No account connected" };
  const refused = [];
  for (const m of maps) {
    const p = probes.find((x) => String(x.external_id).replace(/\D/g, "") === String(m.external_id).replace(/\D/g, ""));
    if (source !== "google_ads" && p && !p.reachable) refused.push(`${m.external_id} — ${p.detail || "provider refused"}`);
  }
  const ids = maps.map((m) => m.external_id).join(", ");
  if (refused.length) return { state: "bad", title: `Connected but cannot read:\n${refused.join("\n")}` };
  return { state: "ok", title: `Access confirmed · ${ids}` };
}

export default function AccessMatrix({ clients, sources, probes }) {
  const rows = (clients || []).map((c) => ({
    ...c,
    cells: PLATFORMS.map(([src]) => cellState(
      src,
      (sources || []).filter((s) => s.client_id === c.id && s.source === src && s.active),
      (probes || []).filter((p) => p.client_slug === c.slug && p.source === src),
    )),
  }));

  return (
    <>
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Client</th>
            {PLATFORMS.map(([src, label]) => <th key={src} style={{ textAlign: "center" }}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/clients/${encodeURIComponent(r.slug)}`} style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}>{r.name}</Link>
                {r.status !== "active" && <span className="muted" style={{ fontSize: 11 }}> · {r.status}</span>}
              </td>
              {r.cells.map((cell, i) => (
                <td key={PLATFORMS[i][0]} style={{ textAlign: "center" }}>
                  <Dot state={cell.state} title={cell.title} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        <Dot state="ok" /> we can read it &nbsp;&nbsp; <Dot state="bad" /> connected but the provider refuses — hover for why &nbsp;&nbsp; – not connected
      </p>
    </>
  );
}
