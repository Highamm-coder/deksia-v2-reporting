import { getSupabaseServer } from "../lib/supabase/server";
import Header from "./_components/Header";

export const dynamic = "force-dynamic";

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export default async function Overview() {
  const supabase = getSupabaseServer();
  const [{ data: pipeline }, { data: goals }] = await Promise.all([
    supabase.from("v_pipeline_health").select("*").order("slug").order("source"),
    supabase.from("v_goal_scoreboard").select("*").order("slug").order("metric_name"),
  ]);
  const fresh = (pipeline || []).filter((r) => r.sync_status === "fresh").length;

  return (
    <>
      <Header />
      <main>
        <h2>Pipeline Health — {fresh}/{pipeline?.length ?? 0} fresh</h2>
        <p className="muted" style={{ margin: "-4px 0 10px", fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
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

        <h2>Goal Scoreboard — {goals?.length ?? 0} active goals</h2>
        <table>
          <thead><tr><th>Client</th><th>Source</th><th>Metric</th><th className="num">Current</th><th className="num">Target</th><th className="num">%</th><th>Status</th><th className="num">Days left</th></tr></thead>
          <tbody>
            {(goals || []).map((g) => (
              <tr key={g.goal_id}>
                <td><a href={`/clients/${encodeURIComponent(g.slug)}`}>{g.slug}</a></td>
                <td className="muted">{g.source}</td>
                <td>{g.metric_name}</td>
                <td className="num">{num(g.current_value, 2)}</td>
                <td className="num">{num(g.target_value, 2)}</td>
                <td className="num">{g.pct_to_target == null ? "—" : Math.round(g.pct_to_target * 100) + "%"}</td>
                <td><span className={`pill ${g.status}`}>{g.status?.replace("_", " ")}</span></td>
                <td className="num">{g.days_remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
