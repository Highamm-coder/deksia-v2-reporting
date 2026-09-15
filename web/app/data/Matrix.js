// Data health grid: client × platform, TWO marks per cell because they are two questions
// with two writers on two clocks:
//   ring  = access    — did the nightly/on-demand probe read the account?   (connection_probes)
//   fill  = freshness — did data land?                                      (v_pipeline_health, hourly)
// A lost permission (red ring) must never look like a paused account (amber fill).
// Every dot links to its own mapping row on /connections.
import Link from "next/link";

export const PLATFORMS = [
  ["meta", "Meta Ads"], ["google_ads", "Google Ads"], ["ga4", "GA4"], ["callrail", "CallRail"], ["pages", "Facebook Pages"],
];
const FILL = { ok: "var(--on)", warn: "var(--risk)", stale: "#9aa3ad", none: "transparent" };
const RING = { ok: "var(--on)", bad: "var(--off)", none: "var(--line)" };

export function Dot({ access, fresh, title, href }) {
  const el = (
    <span title={title} style={{
      display: "inline-block", width: 16, height: 16, borderRadius: 999, boxSizing: "border-box",
      background: FILL[fresh] || "transparent",
      border: `3px solid ${RING[access] || "var(--line)"}`,
    }} />
  );
  if (access === "none" && fresh === "none") return <span title={title} style={{ color: "var(--line)", fontSize: 18, lineHeight: 1 }}>–</span>;
  return href ? <Link href={href} title={title} style={{ display: "inline-block", lineHeight: 0 }}>{el}</Link> : el;
}

const norm = (v) => String(v || "").replace(/\D/g, "") || String(v || "");

// access: ok | bad | none.  Google Ads is API-probed like everything else now.
function accessOf(maps, probes) {
  if (!maps.length) return { state: "none", why: "No account connected" };
  const refused = [];
  for (const m of maps) {
    const p = probes.find((x) => norm(x.external_id) === norm(m.external_id));
    if (p && !p.reachable) refused.push(`${m.params?.label || m.external_id}: ${p.detail || "provider refused"}`);
  }
  return refused.length ? { state: "bad", why: `Cannot read — ${refused.join(" | ")}` } : { state: "ok", why: "Access confirmed" };
}

// fresh: ok | warn | stale | none (four states from the view: fresh / idle / stale / no_data)
function freshOf(maps, health) {
  if (!maps.length) return { state: "none", why: "" };
  if (!health || health.sync_status === "no_data") return { state: "stale", why: "no data has ever landed" };
  const last = health.last_metric_date || "never";
  if (health.sync_status === "fresh") return { state: "ok", why: `data through ${last}` };
  if (health.sync_status === "idle") return { state: "warn", why: last === "never" ? "readable, nothing to report yet" : `nothing to report since ${last}` };
  return { state: "stale", why: `stale — last data ${last}` };
}

export function cellFor(src, maps, probes, health) {
  const a = accessOf(maps, probes), f = freshOf(maps, health);
  const first = maps[0];
  const href = first ? `/connections?client=${encodeURIComponent(first.client_slug || "")}&mapping=${first.id}#mapping-${first.id}` : null;
  return { access: a.state, fresh: f.state, title: [a.why, f.why].filter(Boolean).join("\n"), href };
}

export default function Matrix({ clients, sources, probes, health, platforms }) {
  const COLS = platforms && platforms.length ? platforms : PLATFORMS;
  const rows = (clients || []).map((c) => ({
    ...c,
    cells: COLS.map(([src]) => cellFor(src,
      (sources || []).filter((s) => s.client_id === c.id && s.source === src && s.active).map((s) => ({ ...s, client_slug: c.slug })),
      (probes || []).filter((p) => p.client_slug === c.slug && p.source === src),
      (health || []).find((h) => h.slug === c.slug && h.source === src))),
  }));
  return (
    <>
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Client</th>
            {COLS.map(([src, label]) => <th key={src} style={{ textAlign: "center" }}>{label}</th>)}
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
                <td key={COLS[i][0]} style={{ textAlign: "center" }}><Dot access={cell.access} fresh={cell.fresh} title={cell.title} href={cell.href} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <span><strong>Ring</strong> = access:</span>
        <span><Dot access="ok" fresh="none" /> we can read it</span>
        <span><Dot access="bad" fresh="none" /> provider refuses</span>
        <span style={{ marginLeft: 8 }}><strong>Fill</strong> = freshness:</span>
        <span><Dot access="ok" fresh="ok" /> fresh</span>
        <span><Dot access="ok" fresh="warn" /> idle — readable, nothing to report</span>
        <span><Dot access="ok" fresh="stale" /> stale or never landed</span>
        <span>– not connected</span>
      </p>
    </>
  );
}
