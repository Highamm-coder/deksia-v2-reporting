import { getSupabaseServer } from "../lib/supabase/server";
import AppShell from "./_components/AppShell";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const STATUS_ORDER = ["off_track", "at_risk", "missed", "pending", "on_track", "achieved"];

export default async function Scoreboard() {
  const supabase = getSupabaseServer();
  const { data: goals } = await supabase
    .from("v_goal_scoreboard").select("*").order("slug").order("metric_name");

  const gc = {};
  (goals || []).forEach((g) => { gc[g.status] = (gc[g.status] || 0) + 1; });
  const statuses = STATUS_ORDER.filter((s) => gc[s]);

  return (
    <AppShell>
      <h2>Goal Scoreboard — {goals?.length ?? 0} active goals</h2>
      {statuses.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 14px" }}>
          {statuses.map((s) => <span key={s} className={`pill ${s}`}>{gc[s]} {s.replace("_", " ")}</span>)}
        </div>
      )}
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
      {!goals?.length && <p className="muted">No active goals yet.</p>}
    </AppShell>
  );
}
