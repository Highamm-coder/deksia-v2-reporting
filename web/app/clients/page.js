import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";
import { fmtVal, fmtMonth } from "../../lib/format";

export const dynamic = "force-dynamic";

// Triage view: which clients need attention? Per client — this month's headline
// numbers (from metrics_monthly, agg-aware), goal health, and data freshness.
export default async function Clients() {
  const supabase = getSupabaseServer();
  const [{ data: clients }, { data: monthly }, { data: goals }, { data: pipeline }] = await Promise.all([
    supabase.from("clients").select("id, slug, name, status").order("status").order("slug"),
    supabase.from("metrics_monthly").select("client_id, source, metric_name, month_start, value")
      .in("metric_name", ["spend", "leads", "mqls"]),
    supabase.from("v_goal_scoreboard").select("slug, status"),
    supabase.from("v_pipeline_health").select("slug, sync_status"),
  ]);

  // latest month with data (across the book) = the reporting month
  const months = [...new Set((monthly || []).map((r) => String(r.month_start)))].sort();
  const curMonth = months.at(-1);
  const byClient = {};
  (monthly || []).forEach((r) => {
    if (String(r.month_start) !== curMonth) return;
    const c = (byClient[r.client_id] = byClient[r.client_id] || { spend: 0, leads: 0, mqls: 0 });
    if (r.metric_name === "spend" && (r.source === "meta" || r.source === "google_ads")) c.spend += Number(r.value || 0);
    if (r.metric_name === "leads" && r.source === "meta") c.leads += Number(r.value || 0);
    if (r.metric_name === "mqls" && r.source === "callrail") c.mqls += Number(r.value || 0);
  });

  const goalsBySlug = {};
  (goals || []).forEach((g) => {
    const b = (goalsBySlug[g.slug] = goalsBySlug[g.slug] || { total: 0, attention: 0 });
    b.total += 1;
    if (["off_track", "at_risk", "missed"].includes(g.status)) b.attention += 1;
  });

  const dataBySlug = {};
  (pipeline || []).forEach((p) => {
    const b = (dataBySlug[p.slug] = dataBySlug[p.slug] || { stale: 0, fresh: 0, total: 0 });
    b.total += 1;
    if (p.sync_status === "stale") b.stale += 1;
    if (p.sync_status === "fresh") b.fresh += 1;
  });

  const GoalBadge = ({ slug }) => {
    const g = goalsBySlug[slug];
    if (!g) return <span className="muted">—</span>;
    return g.attention > 0
      ? <span className="pill off_track">{g.attention} need attention</span>
      : <span className="pill on_track">{g.total} on track</span>;
  };
  const DataBadge = ({ slug }) => {
    const d = dataBySlug[slug];
    if (!d) return <span className="muted">—</span>;
    return d.stale > 0
      ? <span className="pill stale">{d.stale} stale</span>
      : d.fresh > 0 ? <span className="pill fresh">fresh</span> : <span className="pill no_data">no data</span>;
  };

  return (
    <AppShell>
      <h2>Clients ({clients?.length ?? 0}) <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· {curMonth ? fmtMonth(String(curMonth).slice(0, 7)) : ""} to date</span></h2>
      <table>
        <thead><tr>
          <th>Client</th>
          <th className="num">Ad spend</th>
          <th className="num">Leads</th>
          <th className="num">MQLs</th>
          <th>Goals</th>
          <th>Data</th>
        </tr></thead>
        <tbody>
          {(clients || []).map((c) => {
            const m = byClient[c.id] || {};
            const inactive = c.status !== "active";
            return (
              <tr key={c.slug} style={inactive ? { opacity: 0.55 } : undefined}>
                <td>
                  <a href={`/clients/${encodeURIComponent(c.slug)}`}>{c.slug}</a>
                  {c.name && c.name !== c.slug ? <span className="muted" style={{ fontSize: 12 }}> · {c.name}</span> : null}
                  {inactive ? <span className="muted" style={{ fontSize: 11 }}> ({c.status})</span> : null}
                </td>
                <td className="num">{m.spend ? fmtVal(m.spend, "usd") : "—"}</td>
                <td className="num">{m.leads ? fmtVal(m.leads, "int") : "—"}</td>
                <td className="num">{m.mqls ? fmtVal(m.mqls, "int") : "—"}</td>
                <td><GoalBadge slug={c.slug} /></td>
                <td><DataBadge slug={c.slug} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        Ad spend = Meta + Google Ads · Leads = Meta · MQLs = CallRail (calls + forms). Current month to date.
      </p>
    </AppShell>
  );
}
