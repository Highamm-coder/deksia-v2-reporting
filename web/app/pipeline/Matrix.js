// Client × platform grid, one dot per cell. Two modes answer two different questions
// over the same rows and columns so the page teaches itself:
//   access     — can we read this account? (nightly probe with the real credential)
//   freshness  — did data land recently? (v_pipeline_health sync_status)
import Link from "next/link";

export const PLATFORMS = [
  ["meta", "Meta"], ["google_ads", "Google Ads"], ["ga4", "GA4"], ["callrail", "CallRail"], ["pages", "Pages"],
];

const COLOR = { ok: "var(--on)", warn: "var(--risk)", bad: "var(--off)" };

export function Dot({ state, title }) {
  if (state === "none") return <span title={title} style={{ color: "var(--line)", fontSize: 18, lineHeight: 1 }}>–</span>;
  return <span title={title} style={{ display: "inline-block", width: 14, height: 14, borderRadius: 999, background: COLOR[state] }} />;
}

// ACCESS. Google Ads is push-based (the MCC script posts to us) so there is no API to
// probe; a mapped account is one the MCC manages, which is the access. Every other
// platform is probed nightly and the provider's answer decides the cell.
function accessCell(source, maps, probes) {
  if (!maps.length) return { state: "none", title: "No account connected" };
  const refused = [];
  for (const m of maps) {
    const p = probes.find((x) => String(x.external_id).replace(/\D/g, "") === String(m.external_id).replace(/\D/g, ""));
    if (source !== "google_ads" && p && !p.reachable) refused.push(`${m.external_id} — ${p.detail || "provider refused"}`);
  }
  if (refused.length) return { state: "bad", title: `Connected but cannot read:\n${refused.join("\n")}` };
  return { state: "ok", title: `Access confirmed · ${maps.map((m) => m.external_id).join(", ")}` };
}

// FRESHNESS. fresh = data within 2 days; idle = the connector is fine but this account had
// nothing to report (no spend, no calls); stale = the connector is behind; no_data = never.
function freshnessCell(maps, health) {
  if (!maps.length) return { state: "none", title: "No account connected" };
  if (!health || health.sync_status === "no_data") return { state: "bad", title: "Connected, but no data has ever landed and the account could not be read" };
  const last = health.last_metric_date || "never";
  const rows = Number(health.rows_30d || 0).toLocaleString();
  if (health.sync_status === "fresh") return { state: "ok", title: `Fresh · data through ${last} · ${rows} rows in 30d` };
  if (health.sync_status === "idle") return { state: "warn", title: last === "never"
      ? "Idle · account is readable but has never had anything to report (e.g. no ads running)"
      : `Idle · connector OK, nothing to report since ${last}` };
  return { state: "bad", title: `Stale · last data ${last} · connector is behind` };
}

export default function Matrix({ mode, clients, sources, probes, health }) {
  const rows = (clients || []).map((c) => ({
    ...c,
    cells: PLATFORMS.map(([src]) => {
      const maps = (sources || []).filter((s) => s.client_id === c.id && s.source === src && s.active);
      return mode === "access"
        ? accessCell(src, maps, (probes || []).filter((p) => p.client_slug === c.slug && p.source === src))
        : freshnessCell(maps, (health || []).find((h) => h.slug === c.slug && h.source === src));
    }),
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
                <td key={PLATFORMS[i][0]} style={{ textAlign: "center" }}><Dot state={cell.state} title={cell.title} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0", display: "flex", gap: 18, flexWrap: "wrap" }}>
        {mode === "access" ? (
          <>
            <span><Dot state="ok" /> we can read it</span>
            <span><Dot state="bad" /> connected but the provider refuses — hover for why</span>
            <span><Dot state="none" /> not connected</span>
          </>
        ) : (
          <>
            <span><Dot state="ok" /> fresh — data within 2 days</span>
            <span><Dot state="warn" /> idle — connector fine, nothing to report (e.g. no spend)</span>
            <span><Dot state="bad" /> stale or never landed — hover for the last date</span>
            <span><Dot state="none" /> not connected</span>
          </>
        )}
      </p>
    </>
  );
}
