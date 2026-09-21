import { getSupabaseServer } from "../lib/supabase/server";
import { readAll } from "../lib/readAll.mjs";
import AppShell from "./_components/AppShell";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const STATUS_ORDER = ["off_track", "at_risk", "missed", "pending", "on_track", "achieved"];

export default async function Scoreboard() {
  const supabase = getSupabaseServer();
  const goals = await readAll(() => supabase.from("v_goal_scoreboard").select("*", { count: "exact" }).order("goal_id"), "Goal scoreboard");
  goals.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || (a.days_remaining ?? Infinity) - (b.days_remaining ?? Infinity) || a.slug.localeCompare(b.slug));

  const gc = {};
  (goals || []).forEach((g) => { gc[g.status] = (gc[g.status] || 0) + 1; });
  const statuses = STATUS_ORDER.filter((s) => gc[s]);

  return (
    <AppShell>
      <p className="muted">Needs attention first · then nearest deadline. Open a client to review coverage and next steps.</p>
      <h2>Goal Scoreboard — {goals?.length ?? 0} active goals</h2>
      {statuses.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 14px" }}>
          {statuses.map((s) => <span key={s} className={`pill ${s}`}>{gc[s]} {s.replace("_", " ")}</span>)}
        </div>
      )}
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable report table"><table>
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
      </table></div>
      {!goals?.length && <p className="muted">No active goals yet.</p>}
    </AppShell>
  );
}
