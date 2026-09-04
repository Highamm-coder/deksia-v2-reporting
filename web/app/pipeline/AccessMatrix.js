// Access matrix: one row per client, one column per platform, a dot per cell.
//   green  — mapped, the nightly probe reached every account, and data is fresh
//   red    — mapped but something is wrong: unreachable, stale, or never posted
//   grey   — not connected (no mapping in client_sources)
// Hover a dot for the reason. Numbers beside a dot = how many accounts that cell covers.
import Link from "next/link";

export const PLATFORMS = [
  ["meta", "Meta"], ["google_ads", "Google Ads"], ["ga4", "GA4"], ["callrail", "CallRail"], ["pages", "Pages"],
];

const DOT = {
  ok:   { bg: "var(--on)",  ring: "rgba(30,142,62,.18)",  label: "connected" },
  bad:  { bg: "var(--off)", ring: "rgba(217,48,37,.16)",  label: "problem" },
  none: { bg: "transparent", ring: "transparent", border: "1.5px solid var(--line)", label: "not connected" },
};

function Dot({ state, title, count }) {
  const d = DOT[state];
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 12, height: 12, borderRadius: 999, background: d.bg, border: d.border,
        boxShadow: state === "none" ? "none" : `0 0 0 4px ${d.ring}`, display: "inline-block",
      }} />
      {count > 1 && <span className="muted" style={{ fontSize: 11 }}>×{count}</span>}
    </span>
  );
}

// Decide the cell. `maps` = client_sources rows for this client×source, `probes` = latest
// probe per account, `health` = v_pipeline_health row for the client×source.
export function cellState(maps, probes, health) {
  if (!maps.length) return { state: "none", title: "Not connected — no account mapped", count: 0 };
  const reasons = [];
  for (const m of maps) {
    const p = probes.find((x) => String(x.external_id).replace(/\D/g, "") === String(m.external_id).replace(/\D/g, ""));
    if (p && !p.reachable) reasons.push(`${m.external_id}: ${p.detail || "unreachable"}`);
  }
  if (!health || health.sync_status === "no_data") reasons.push("no data has ever landed");
  else if (health.sync_status !== "fresh") reasons.push(`data ${health.sync_status} — last ${health.last_metric_date || "never"}`);
  const ids = maps.map((m) => m.external_id).join(", ");
  return reasons.length
    ? { state: "bad", title: reasons.join("\n"), count: maps.length }
    : { state: "ok", title: `Connected · ${ids}${health?.last_metric_date ? ` · data through ${health.last_metric_date}` : ""}`, count: maps.length };
}

export default function AccessMatrix({ clients, sources, probes, health }) {
  const rows = (clients || []).map((c) => {
    const cells = PLATFORMS.map(([src]) => {
      const maps = (sources || []).filter((s) => s.client_id === c.id && s.source === src && s.active);
      const pr = (probes || []).filter((p) => p.client_slug === c.slug && p.source === src);
      const h = (health || []).find((x) => x.slug === c.slug && x.source === src);
      return cellState(maps, pr, h);
    });
    return { ...c, cells };
  });
  const totals = PLATFORMS.map((_, i) => ({
    ok: rows.filter((r) => r.cells[i].state === "ok").length,
    bad: rows.filter((r) => r.cells[i].state === "bad").length,
  }));

  return (
    <>
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Client</th>
            {PLATFORMS.map(([src, label], i) => (
              <th key={src} style={{ textAlign: "center" }}>
                {label}
                <div style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", marginTop: 2 }}>
                  <span style={{ color: "var(--on)" }}>{totals[i].ok}</span>
                  {totals[i].bad > 0 && <span style={{ color: "var(--off)" }}> · {totals[i].bad}</span>}
                </div>
              </th>
            ))}
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
                  <Dot state={cell.state} title={cell.title} count={cell.count} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ display: "flex", gap: 18, fontSize: 12, marginTop: 8, flexWrap: "wrap" }}>
        <span><Dot state="ok" /> connected — probe reached every account and data is fresh</span>
        <span><Dot state="bad" /> problem — hover the dot for the provider&apos;s reason</span>
        <span><Dot state="none" /> not connected</span>
      </div>
    </>
  );
}
