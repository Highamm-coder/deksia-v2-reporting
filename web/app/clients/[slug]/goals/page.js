import { getSupabaseServer } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export default async function GoalsTab({ params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const { data: goals } = await supabase.from("v_goal_scoreboard").select("*").eq("slug", slug).order("metric_name");

  return (
    <>
      <h2>Goals ({goals?.length ?? 0})</h2>
      {goals?.length ? (
        <table>
          <thead><tr><th>Source</th><th>Metric</th><th className="num">Current</th><th className="num">Target</th><th className="num">%</th><th>Status</th><th className="num">Days left</th></tr></thead>
          <tbody>
            {goals.map((g) => (
              <tr key={g.goal_id}>
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
      ) : <p className="muted">No goals set for this client.</p>}
    </>
  );
}
