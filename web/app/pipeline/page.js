import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const PROVIDER_LABEL = {
  meta: "Meta access token", google_oauth: "Google OAuth (GA4)",
  callrail: "CallRail API key", ingest_token: "Ingest token (Ads Scripts)",
};

function credPill(c) {
  if (c.status === "expired") return ["off_track", "expired"];
  if (c.status !== "ok") return ["pending", c.status];
  if (!c.expires_at) return ["fresh", "no expiry"];
  const days = Math.round((new Date(c.expires_at) - Date.now()) / 864e5);
  if (days <= 0) return ["off_track", "expired"];
  if (days <= 5) return ["off_track", `${days}d left`];
  if (days <= 14) return ["stale", `${days}d left`];
  return ["fresh", `${days}d left`];
}

export default async function Pipeline() {
  const supabase = getSupabaseServer();
  const [{ data: pipeline }, { data: creds }, { data: checks }] = await Promise.all([
    supabase.from("v_pipeline_health").select("*").order("slug").order("source"),
    supabase.from("connector_status").select("*").order("provider"),
    supabase.from("integrity_checks").select("*").order("checked_at", { ascending: false }).limit(1),
  ]);
  const fresh = (pipeline || []).filter((r) => r.sync_status === "fresh").length;
  const chk = checks?.[0] || null;
  const chkPill = chk ? (chk.status === "ok" ? "fresh" : chk.status === "attention" ? "stale" : "off_track") : "pending";

  return (
    <AppShell>
      <h2>Data integrity</h2>
      <div className="card" style={{ maxWidth: "none", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {chk ? (
          <>
            <span className={`pill ${chkPill}`} style={{ fontSize: 12 }}>
              {chk.status === "ok" ? "✓ verified" : chk.status === "attention" ? "⚠ attention" : "✕ issues"}
            </span>
            <span style={{ fontSize: 13 }}>
              {chk.status === "ok"
                ? `No gaps in the last ${chk.summary?.window_days ?? 14} days — every source-day present or verified with the platform.`
                : chk.summary?.google_ads_gaps?.length
                  ? `Google Ads missing: ${chk.summary.google_ads_gaps.join(", ")} — run the MCC backfill script for those dates.`
                  : `${chk.summary?.sweep_failures ?? "?"} re-pull failure(s) during the gap sweep — check the run log.`}
            </span>
            {chk.gaps_found > 0 && chk.rows_healed > 0 && (
              <span className="muted" style={{ fontSize: 12 }}>self-healed {chk.gaps_found} gap-day(s), {chk.rows_healed.toLocaleString()} rows re-pulled</span>
            )}
            <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
              checked {new Date(chk.checked_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · runs nightly
            </span>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>First integrity check runs with tonight&apos;s sync.</span>
        )}
      </div>

      <h2>Credentials</h2>
      <table>
        <thead><tr><th>Credential</th><th>Status</th><th>Expires</th><th style={{ whiteSpace: "normal" }}>Detail</th><th>Checked</th></tr></thead>
        <tbody>
          {(creds || []).map((c) => {
            const [cls, txt] = credPill(c);
            return (
              <tr key={c.provider}>
                <td>{PROVIDER_LABEL[c.provider] || c.provider}</td>
                <td><span className={`pill ${cls}`}>{txt}</span></td>
                <td>{c.expires_at ? new Date(c.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                <td className="muted" style={{ whiteSpace: "normal", fontSize: 12 }}>{c.detail}</td>
                <td className="muted" style={{ fontSize: 12 }}>{c.checked_at ? new Date(c.checked_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ margin: "4px 0 18px", fontSize: 12 }}>
        Meta expiry is read from Facebook&apos;s own token introspection on every nightly run — never hand-maintained.
      </p>

      <h2>Pipeline Health — {fresh}/{pipeline?.length ?? 0} fresh</h2>
      <p className="muted" style={{ margin: "-4px 0 12px", fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span><span className="pill fresh">fresh</span> recent data</span>
        <span><span className="pill idle">idle</span> connector OK, no recent activity (e.g. no spend)</span>
        <span><span className="pill stale">stale</span> connector behind — needs attention</span>
        <span><span className="pill no_data">no data</span> never synced</span>
      </p>
      <table>
        <thead><tr><th>Client</th><th>Source</th><th>Status</th><th>Last data</th><th className="num">Rows 30d</th><th className="num">Metrics</th></tr></thead>
        <tbody>
          {(pipeline || []).map((r, i) => (
            <tr key={i}>
              <td><a href={`/clients/${encodeURIComponent(r.slug)}`}>{r.slug}</a></td>
              <td className="muted">{r.source}</td>
              <td><span className={`pill ${r.sync_status}`}>{r.sync_status?.replace("_", " ")}</span></td>
              <td>{r.last_metric_date || "—"}</td>
              <td className="num">{num(r.rows_30d)}</td>
              <td className="num">{num(r.metric_count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
