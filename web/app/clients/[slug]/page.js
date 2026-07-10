import { getSupabaseServer } from "../../../lib/supabase/server";
import Performance from "./Performance";
import Campaigns from "./Campaigns";
import PlatformNav from "./PlatformNav";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const PLATFORM_ORDER = ["google_ads", "meta", "ga4", "callrail", "pages", "email", "seo", "other"];
const PLATFORM_LABEL = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", callrail: "CallRail", pages: "Facebook Pages", email: "Email", seo: "SEO", other: "Other" };
const PAID = new Set(["google_ads", "meta"]);
const GOAL_STATUS_ORDER = ["off_track", "at_risk", "missed", "pending", "on_track", "achieved"];

export default async function ClientDashboard({ params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: detail }, { data: campaigns }, { data: goals }, { data: provRows }] = await Promise.all([
    supabase.from("v_client_report_detail").select("*").eq("slug", slug),
    supabase.from("v_client_campaigns").select("*").eq("slug", slug),
    supabase.from("v_goal_scoreboard").select("*").eq("slug", slug).order("metric_name"),
    supabase.from("v_client_provenance").select("*").eq("slug", slug),
  ]);
  // provenance keyed by source|account for the section ⓘ popovers
  const prov = {};
  (provRows || []).forEach((p) => { prov[`${p.source}|${p.account_ext_id}`] = p; });

  const platforms = PLATFORM_ORDER.filter((p) => (detail || []).some((r) => r.source === p));
  const anchor = { scrollMarginTop: 60 }; // clear the sticky header/nav when jumping

  return (
    <>
      {/* pinned highlights across all platforms */}
      <Performance detail={detail} showTables={false} />

      <PlatformNav platforms={platforms} />

      {platforms.map((p) => (
        <section id={p} key={p} style={anchor}>
          <h2 style={{ color: "var(--accent)" }}>{PLATFORM_LABEL[p] || p}</h2>
          <Performance detail={detail} only={[p]} showHighlights={false} prov={prov} />
          {PAID.has(p) && <Campaigns campaigns={(campaigns || []).filter((c) => c.source === p)} />}
        </section>
      ))}

      <section id="goals" style={anchor}>
        <h2 style={{ color: "var(--accent)" }}>Goals ({goals?.length ?? 0}){" "}
          <a href={`/clients/${encodeURIComponent(slug)}/goals`} style={{ fontSize: 12, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· manage →</a>
        </h2>
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
      </section>

      <p className="muted" style={{ fontSize: 11, marginTop: 18 }}>
        Agg-aware (counts summed, rates as the platform reports them). Pin ★ any metric to add it to
        the Highlights strip — saved in this browser.
      </p>
    </>
  );
}
