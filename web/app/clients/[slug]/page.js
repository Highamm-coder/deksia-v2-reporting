import { getSupabaseServer } from "../../../lib/supabase/server";
import Performance from "./Performance";
import Campaigns from "./Campaigns";
import Derived from "./Derived";
import Events from "./Events";
import LeadSources from "./LeadSources";
import TopQueries from "./TopQueries";
import PlatformNav from "./PlatformNav";
import MonthPicker from "./MonthPicker";
import { readAll, requireData } from "../../../lib/readAll.mjs";
import { ym, metricKey, shiftMonth, reportingDate, comparisonWindow, compareRows, buildSeries, compareDerived } from "../../../lib/reporting.mjs";
import { statusSentence, toneColor } from "../../../lib/statusSentence";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const PLATFORM_ORDER = ["google_ads", "meta", "ga4", "search_console", "youtube", "callrail", "pages", "manual", "email", "seo", "other"];
const PLATFORM_LABEL = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", search_console: "Search Console", youtube: "YouTube", callrail: "CallRail", pages: "Facebook Pages", manual: "Tracked manually", email: "Email", seo: "SEO", other: "Other" };
const PAID = new Set(["google_ads", "meta"]);

export default async function ClientDashboard({ params, searchParams }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const today = reportingDate();
  // Month discovery transfers only month metadata; detail is limited to the selected period.
  const monthRows = await readAll(() => supabase.from("v_client_monthly")
    .select("month_start, source, account_ext_id, metric_name", { count: "exact" }).eq("slug", slug)
    .order("month_start").order("source").order("account_ext_id").order("metric_name"), "Reporting months");
  const months = [...new Set(monthRows.map(r => ym(r.month_start)))].sort().reverse();
  const req = typeof searchParams?.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month) ? searchParams.month : null;
  const M = req && months.includes(req) ? req : months[0] || ym(today);
  const window = comparisonWindow(M, today);
  const P = window.previous;
  const isMtd = window.current;
  const mtdDays = isMtd ? window.currentDays : null;
  const periodRows = (view, start = M, end = M, keys = []) => readAll(() => {
    let query = supabase.from(view).select("*", { count: "exact" }).eq("slug", slug)
      .gte("month_start", `${start}-01`).lt("month_start", `${shiftMonth(end, 1)}-01`).order("month_start");
    for (const key of keys) query = query.order(key);
    return query;
  }, view);
  const [monthly, campaigns, goals, provRows, derivedAll, health, events, objectivesAll, drill, leadSources, statusRows, searchQueries, mappings] = await Promise.all([
    periodRows("v_client_monthly", shiftMonth(M, -11), M, ["source", "account_ext_id", "metric_name"]),
    periodRows("v_client_campaigns_all", M, M, ["source", "account_ext_id", "campaign"]),
    readAll(() => supabase.from("v_goal_scoreboard").select("*", { count: "exact" }).eq("slug", slug).order("goal_id"), "Goals"),
    requireData(supabase.from("v_client_provenance").select("*").eq("slug", slug), "Provenance"),
    periodRows("v_client_derived_all", M, M, ["derived_id"]),
    requireData(supabase.from("v_pipeline_health").select("*").eq("slug", slug).order("source"), "Source health"),
    periodRows("v_client_events", M, M, ["account_ext_id", "campaign", "event"]),
    requireData(supabase.from("client_objectives").select("*, clients!inner(slug)").eq("clients.slug", slug).eq("active", true).order("kind").order("position").order("created_at"), "Objectives"),
    periodRows("v_client_campaign_drill", M, M, ["source", "account_ext_id", "campaign", "ad_set", "ad"]),
    periodRows("v_client_lead_sources", M, M, ["channel", "lead_source"]),
    requireData(supabase.from("v_client_source_status").select("*").eq("slug", slug), "Source status"),
    periodRows("v_client_search_queries", M, M, ["account_ext_id", "query"]),
    requireData(supabase.from("client_sources").select("source, external_id, active, params, clients!inner(slug)").eq("clients.slug", slug), "Account mappings"),
  ]);
  const objectives = objectivesAll || [];
  const goalById = Object.fromEntries(goals.map(g => [g.goal_id, g]));
  let current = monthly.filter(r => ym(r.month_start) === M);
  let previous = monthly.filter(r => ym(r.month_start) === P);
  if (isMtd && mtdDays > 0) {
    // The existing RPC aggregates the first N calendar days of the supplied month.
    // Read BOTH periods through it, including month-end clamping for shorter months.
    const [curPartial, prevPartial] = await Promise.all([M, P].map(month =>
      readAll(() => supabase.rpc("client_prev_partial", { p_slug: slug, p_prev_month: month, p_days: mtdDays }, { count: "exact" })
        .order("source").order("account_ext_id").order("metric_name"), "Period comparison")));
    const metadata = new Map(current.map(r => [metricKey(r), r]));
    current = curPartial.map(r => ({ ...metadata.get(metricKey(r)), ...r, month_start: `${M}-01` }));
    previous = prevPartial.map(r => ({ ...r, month_start: `${P}-01` }));
  }
  const detail = compareRows(current, previous, window);
  const series = buildSeries(monthly, M, ym(today));
  const scFullDepth = mappings.some(s => s.source === "search_console" && s.active && s.params?.metric_depth === "full");
  const derived = derivedAll.map(r => ({ ...compareDerived(r, detail, mappings), cur_month: r.month_start }));

  // ---- platforms: everything mapped OR with data; explicit empty state for gaps ----
  const withData = new Set(detail.map((r) => r.source));
  const mapped = new Set((health || []).map((h) => h.source));
  const platforms = PLATFORM_ORDER.filter((p) => withData.has(p) || mapped.has(p));
  const healthBy = {};
  (health || []).forEach((h) => { healthBy[h.source] = h; });

  const prov = {};
  (provRows || []).forEach((p) => { prov[`${p.source}|${p.account_ext_id}`] = p; });

  const anchor = { scrollMarginTop: 60 };

  return (
    <>
      {/* objectives: the business goal + engagement goals, always first */}
      {objectives.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "2px 0 14px" }}>
          {objectives.map((o) => {
            const lg = o.goal_id ? goalById[o.goal_id] : null;
            const biz = o.kind === "business";
            return (
              <div key={o.id} style={{
                flex: biz ? "1 1 100%" : "1 1 260px",
                background: biz ? "var(--accent-soft)" : "var(--panel)",
                border: `1px solid ${biz ? "var(--line)" : "var(--line)"}`,
                borderRadius: 14, padding: biz ? "14px 18px" : "11px 14px",
              }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em",
                  color: biz ? "var(--accent)" : "var(--muted)" }}>
                  {biz ? "🎯 Business goal" : "Engagement goal"}
                </div>
                <div style={{ fontSize: biz ? 17 : 13.5, fontWeight: 700, marginTop: 3 }}>{o.title}</div>
                {o.detail && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{o.detail}</div>}
                {lg && (
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <span className={`pill ${lg.status}`}>{lg.status?.replace("_", " ")}</span>
                    <span className="muted">{lg.metric_name}: {num(lg.current_value, 1)} / {num(lg.target_value, 1)}
                      {lg.pct_to_target != null ? ` (${Math.round(lg.pct_to_target * 100)}%)` : ""}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "2px 0 4px" }}>
        <MonthPicker months={months} />
        {isMtd && (
          <span className="pill mtd" title={`Comparison window: ${M}-01 through day ${mtdDays}; same calendar days in ${P}. Comparisons require complete coverage.`}>
            MTD · {mtdDays > 0 ? `first ${mtdDays} closed days vs ${P}` : "awaiting the first closed day"}
          </span>
        )}
      </div>

      {/* pinned highlights across all platforms */}
      <Performance detail={detail} showTables={false} series={series} prov={prov} mtdDays={mtdDays} />

      {/* Deksia-computed formulas (e.g. Blended CPL) — clearly separated from platform numbers */}
      <Derived derived={derived} />
      <p className="muted">Comparisons require complete coverage in both periods. Trend lines show complete months only.</p>

      <PlatformNav platforms={platforms} />

      {platforms.map((p) => {
        const has = withData.has(p);
        const h = healthBy[p];
        return (
          <section id={p} key={p} style={anchor}>
            <h2 style={{ color: "var(--accent)" }}>{PLATFORM_LABEL[p] || p}</h2>
            {has ? (
              <>
                <Performance detail={detail} only={[p]} showHighlights={false} prov={prov} mtdDays={mtdDays} />
                {PAID.has(p) && <Campaigns campaigns={campaigns.filter((c) => c.source === p)} drill={drill.filter((d) => d.source === p)} />}
                {p === "google_ads" && <Events events={events} />}
                {p === "callrail" && <LeadSources rows={leadSources} />}
                {p === "search_console" && <TopQueries rows={searchQueries} fullDepth={scFullDepth} month={M} />}
              </>
            ) : (
              <div className="card" style={{ maxWidth: "none", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  No {PLATFORM_LABEL[p] || p} data for {M}.
                </span>
                {h && <span className={`pill ${h.sync_status}`}>{h.sync_status?.replace("_", " ")}</span>}
                {(() => { const st = (statusRows || []).find((x) => x.source === p); const sent = statusSentence(st || (h ? { ...h, source: p } : null));
                  return <span style={{ fontSize: 12, color: toneColor[sent.tone] }}>{sent.text}</span>; })()}
                <a href={`/clients/${encodeURIComponent(slug)}/settings`} style={{ fontSize: 12 }}>source status →</a>
              </div>
            )}
          </section>
        );
      })}

      <section id="goals" style={anchor}>
        <h2 style={{ color: "var(--accent)" }}>Goals ({goals?.length ?? 0}){" "}
          <a href={`/clients/${encodeURIComponent(slug)}/goals`} style={{ fontSize: 12, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· manage →</a>
        </h2>
        {goals?.length ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable report table"><table>
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
          </table></div>
        ) : <p className="muted">No goals set for this client.</p>}
      </section>

      <p className="muted" style={{ fontSize: 11, marginTop: 18 }}>
        Agg-aware (counts summed, rates as the platform reports them). Pin ★ any metric to add it to
        the Highlights strip — saved in this browser.
      </p>
    </>
  );
}
