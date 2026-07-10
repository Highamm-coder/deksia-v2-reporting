import { getSupabaseServer } from "../../lib/supabase/server";
import AppShell from "../_components/AppShell";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export default async function Pipeline() {
  const supabase = getSupabaseServer();
  const { data: pipeline } = await supabase
    .from("v_pipeline_health").select("*").order("slug").order("source");
  const fresh = (pipeline || []).filter((r) => r.sync_status === "fresh").length;

  return (
    <AppShell>
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
