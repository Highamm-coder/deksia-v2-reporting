import { getSupabaseServer } from "../../../lib/supabase/server";
import Performance from "./Performance";
import Campaigns from "./Campaigns";
import Derived from "./Derived";
import Events from "./Events";
import LeadSources from "./LeadSources";
import TopQueries from "./TopQueries";
import SourceTabs from "./SourceTabs";
import MetricTrend from "./MetricTrend";
import MonthPicker from "./MonthPicker";
import { statusSentence, toneColor } from "../../../lib/statusSentence";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const PLATFORM_ORDER = ["google_ads", "meta", "ga4", "search_console", "youtube", "callrail", "pages", "manual", "email", "seo", "other"];
const PLATFORM_LABEL = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", search_console: "Search Console", youtube: "YouTube", callrail: "CallRail", pages: "Facebook Pages", manual: "Tracked manually", email: "Email", seo: "SEO", other: "Other" };
const PAID = new Set(["google_ads", "meta"]);

const ym = (d) => String(d).slice(0, 7);
const prevYm = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const daysInMonth = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo, 0).getDate();
};
const etNowYm = () => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date());
  return p.slice(0, 7);
};
const pct = (cur, prev) => (prev != null && Number(prev) !== 0 ? (Number(cur) - Number(prev)) / Math.abs(Number(prev)) : null);

export default async function ClientDashboard({ params, searchParams }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  const [{ data: monthly }, { data: campaignsAll }, { data: goals }, { data: provRows }, { data: derivedAll }, { data: health }, { data: eventsAll }, { data: objectivesAll }, { data: drillAll }, { data: leadSrcAll }, { data: statusRows }, { data: queriesAll }, { data: scMappings }] = await Promise.all([ 
    supabase.from("v_client_monthly").select("*").eq("slug", slug),
    supabase.from("v_client_campaigns_all").select("*").eq("slug", slug),
    supabase.from("v_goal_scoreboard").select("*").eq("slug", slug).order("metric_name"),
    supabase.from("v_client_provenance").select("*").eq("slug", slug),
    supabase.from("v_client_derived_all").select("*").eq("slug", slug).order("label"),
    supabase.from("v_pipeline_health").select("*").eq("slug", slug).order("source"),
    supabase.from("v_client_events").select("*").eq("slug", slug),
    supabase.from("client_objectives").select("*, clients!inner(slug)").eq("clients.slug", slug).eq("active", true).order("kind").order("position").order("created_at"),
    supabase.from("v_client_campaign_drill").select("*").eq("slug", slug),
    supabase.from("v_client_lead_sources").select("*").eq("slug", slug),
    supabase.from("v_client_source_status").select("*").eq("slug", slug),
    supabase.from("v_client_search_queries").select("*").eq("slug", slug),
    supabase.from("client_sources").select("source, params, clients!inner(slug)").eq("clients.slug", slug).eq("source", "search_console").eq("active", true),
  ]);
  const objectives = objectivesAll || [];
  const goalById = {};
  (goals || []).forEach((g) => { goalById[g.goal_id] = g; });

  // ---- month selection: ?month=YYYY-MM, default = latest month with data ----
  const months = [...new Set((monthly || []).map((r) => ym(r.month_start)))].sort().reverse();
  const req = typeof searchParams?.month === "string" && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : null;
  const M = req && months.includes(req) ? req : months[0];
  const P = M ? prevYm(M) : null;

  // ---- MTD? then compare like-for-like ----
  // An in-progress month must not be compared to a FULL prior month; use the same
  // number of elapsed days from the prior month instead.
  const isMtd = M === etNowYm();
  const elapsed = isMtd
    ? Math.max(0, ...(monthly || []).filter((r) => ym(r.month_start) === M).map((r) => Number(r.day_count || 0)))
    : null;
  let prevPartial = null;
  if (isMtd && elapsed > 0 && P) {
    const { data } = await supabase.rpc("client_prev_partial", {
      p_slug: slug, p_prev_month: P, p_days: elapsed,
    });
    prevPartial = data || [];
  }

  // ---- build the report rows (selected vs previous month) in the shape the tables use ----
  const key = (r) => `${r.source}|${r.account_ext_id}|${r.metric_name}`;
  const prevBy = {};
  // Sources whose prior-period baseline does not cover the whole window, because the mapping
  // started part-way through it. Dividing by a truncated baseline invents a percentage
  // (Goodside read +399% off 11 days vs 21), so drop it and say why — see migration 0072.
  const partialBaseline = new Set();
  if (prevPartial) {
    prevPartial.forEach((r) => {
      if (r.complete === false) { partialBaseline.add(r.source); return; }
      prevBy[key(r)] = { value: r.value, day_count: r.day_count, month_start: `${P}-01` };
    });
  } else {
    (monthly || []).forEach((r) => { if (ym(r.month_start) === P) prevBy[key(r)] = r; });
  }
  // conversion_action is shown named in the Events table, not as a meaningless sum row
  const detail = (monthly || []).filter((r) => ym(r.month_start) === M && r.metric_name !== "conversion_action").map((r) => {
    const p = prevBy[key(r)];
    return {
      ...r,
      cur_month: r.month_start, cur_value: r.value, cur_days: r.day_count,
      prev_month: p?.month_start ?? null, prev_value: p?.value ?? null, prev_days: p?.day_count ?? null,
      pct_change: pct(r.value, p?.value),
    };
  });

  // ---- client-level monthly series for sparklines (additive metrics only) ----
  const sums = {};
  (monthly || []).forEach((r) => {
    if (r.agg !== "sum") return;
    ((sums[r.metric_name] = sums[r.metric_name] || {})[ym(r.month_start)] ||= 0);
    sums[r.metric_name][ym(r.month_start)] += Number(r.value || 0);
  });
  const asc = months.slice().reverse();
  const series = {};
  Object.entries(sums).forEach(([met, byM]) => {
    series[met] = asc.map((m) => ({ m, v: byM[m] ?? null }));
  });

  // ---- per-SOURCE monthly series for the trend chart ----------------------------------
  // Deliberately not keyed by metric alone: "clicks" exists under Google Ads, Meta, GA4,
  // Pages and Search Console, and adding them would invent a number no platform reported.
  // Rates are averaged across a source's accounts, counts are summed — the same rule the
  // monthly view applies. A month with no row stays null so the chart can leave a gap.
  const trendAcc = {};
  (monthly || []).forEach((r) => {
    if (r.metric_name === "conversion_action") return;
    const k = `${r.source}|${r.metric_name}`;
    const t = (trendAcc[k] = trendAcc[k] || {
      key: k, source: r.source, metric: r.metric_name, unit: r.unit, agg: r.agg,
      description: r.description || "", byM: {},
    });
    const cell = (t.byM[ym(r.month_start)] ||= { sum: 0, n: 0 });
    cell.sum += Number(r.value || 0);
    cell.n += 1;
  });
  const trendSeries = Object.values(trendAcc)
    .map((t) => ({
      key: t.key, source: t.source, metric: t.metric, unit: t.unit, agg: t.agg,
      description: t.description,
      points: asc.map((m) => {
        const c = t.byM[m];
        return { m, v: c ? (t.agg === "avg" ? c.sum / c.n : c.sum) : null };
      }),
    }))
    .filter((t) => t.points.filter((p) => p.v != null).length >= 2)
    .sort((a, b) => a.source.localeCompare(b.source) || a.metric.localeCompare(b.metric));

  // ---- campaigns + events + computed metrics for the selected month ----
  const campaigns = (campaignsAll || []).filter((r) => ym(r.month_start) === M);
  const drill = (drillAll || []).filter((r) => ym(r.month_start) === M);
  const events = (eventsAll || []).filter((r) => ym(r.month_start) === M);
  const leadSources = (leadSrcAll || []).filter((r) => ym(r.month_start) === M);
  const searchQueries = (queriesAll || []).filter((r) => ym(r.month_start) === M);
  const scFullDepth = (scMappings || []).some((s) => s.params?.metric_depth === "full");
  const derived = (derivedAll || [])
    .filter((r) => ym(r.month_start) === M)
    .map((r) => {
      const p = (derivedAll || []).find((x) => x.derived_id === r.derived_id && ym(x.month_start) === P);
      return {
        ...r,
        cur_month: r.month_start, cur_num: r.num, cur_den: r.den, cur_value: r.value,
        prev_month: p?.month_start ?? null, prev_value: p?.value ?? null,
        pct_change: pct(r.value, p?.value),
      };
    });

  // ---- MTD flag: selected month is the current (incomplete) calendar month ----
  const mtdDays = elapsed;

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
                  {biz ? "Business goal" : "Engagement goal"}
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
          <span className="pill mtd" title={`Month in progress. MoM compares these ${mtdDays} days against the first ${mtdDays} days of the prior month — like for like.`}>
            MTD · {mtdDays} day{mtdDays === 1 ? "" : "s"} · vs same {mtdDays} days last month
          </span>
        )}
        {isMtd && partialBaseline.size > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            No comparison shown for {[...partialBaseline].map((x) => PLATFORM_LABEL[x] || x).join(", ")} —
            {partialBaseline.size === 1 ? " that connection" : " those connections"} only started part-way through last month.
          </span>
        )}
      </div>

      {/* pinned highlights across all platforms */}
      <Performance detail={detail} showTables={false} series={series} mtdDays={mtdDays} />

      {/* Deksia-computed formulas (e.g. Blended CPL) — clearly separated from platform numbers */}
      <Derived derived={derived} />

      {/* follow one metric month by month */}
      <MetricTrend series={trendSeries} />

      {/* one tab per source, plus goals — panels below must stay in this order */}
      <SourceTabs tabs={[
        ...platforms.map((p) => ({ key: p, label: PLATFORM_LABEL[p] || p, hasData: withData.has(p) })),
        { key: "goals", label: `Goals (${goals?.length ?? 0})`, hasData: (goals?.length ?? 0) > 0 },
      ]}>
      {[...platforms.map((p) => {
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
      }),

      <section key="goals" id="goals" style={anchor}>
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
      </section>,
      ]}
      </SourceTabs>

      <p className="muted" style={{ fontSize: 11, marginTop: 18 }}>
        Agg-aware (counts summed, rates as the platform reports them). Pin ★ any metric to add it to
        the Highlights strip — saved in this browser.
      </p>
    </>
  );
}
