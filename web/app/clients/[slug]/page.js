import { getSupabaseServer } from "../../../lib/supabase/server";
import Performance from "./Performance";

export const dynamic = "force-dynamic";

const STATUS_ORDER = ["off_track", "at_risk", "missed", "pending", "on_track", "achieved"];

export default async function ClientOverview({ params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: detail }, { data: goals }, { data: pipeline }] = await Promise.all([
    supabase.from("v_client_report_detail").select("*").eq("slug", slug),
    supabase.from("v_goal_scoreboard").select("status").eq("slug", slug),
    supabase.from("v_pipeline_health").select("source, sync_status, last_metric_date").eq("slug", slug).order("source"),
  ]);

  // goal status counts
  const gc = {};
  (goals || []).forEach((g) => { gc[g.status] = (gc[g.status] || 0) + 1; });
  const statuses = STATUS_ORDER.filter((s) => gc[s]);

  return (
    <>
      <Performance detail={detail} showTables={false} />

      <h2>Goals ({goals?.length ?? 0})</h2>
      {statuses.length ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {statuses.map((s) => (
            <span key={s} className={`pill ${s}`}>{gc[s]} {s.replace("_", " ")}</span>
          ))}
          <a href={`/clients/${encodeURIComponent(slug)}/goals`} style={{ fontSize: 12, alignSelf: "center" }}>view all →</a>
        </div>
      ) : <p className="muted">No goals set.</p>}

      <h2>Sources</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(pipeline || []).map((p) => (
          <span key={p.source} className={`pill ${p.sync_status}`} title={`last data ${p.last_metric_date || "—"}`}>
            {p.source} · {p.sync_status?.replace("_", " ")}
          </span>
        ))}
        <a href={`/clients/${encodeURIComponent(slug)}/settings`} style={{ fontSize: 12, alignSelf: "center" }}>details →</a>
      </div>
    </>
  );
}
