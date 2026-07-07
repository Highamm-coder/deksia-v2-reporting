import { getSupabaseServer } from "../../../lib/supabase/server";
import Header from "../../_components/Header";
import ScriptBlock from "../../_components/ScriptBlock";
import { fmtVal, fmtDelta, fmtMonth } from "../../../lib/format";
import { generateGoogleAdsScript } from "../../../lib/googleAdsScript";

export const dynamic = "force-dynamic";
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const SRC_LABEL = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", callrail: "CallRail", pages: "Facebook Pages", email: "Email", seo: "SEO", other: "Other" };
const SRC_ORDER = ["google_ads", "meta", "ga4", "callrail", "pages", "email", "seo", "other"];
// Headline KPIs to lift to the top when present: [source, metric, label].
const HEADLINE = [
  ["meta", "spend", "Meta Spend"],
  ["google_ads", "spend", "Ads Spend"],
  ["meta", "leads", "Meta Leads"],
  ["callrail", "mqls", "CallRail MQLs"],
  ["ga4", "sessions", "GA4 Sessions"],
  ["ga4", "users", "GA4 Users"],
];

export default async function ClientDetail({ params }) {
  const slug = decodeURIComponent(params.slug);
  const supabase = getSupabaseServer();
  // single round trip: embed client_sources via FK, parallel with views
  const [{ data: client }, { data: goals }, { data: pipeline }, { data: report }] = await Promise.all([
    supabase.from("clients").select("*, client_sources(*)").eq("slug", slug).maybeSingle(),
    supabase.from("v_goal_scoreboard").select("*").eq("slug", slug).order("metric_name"),
    supabase.from("v_pipeline_health").select("*").eq("slug", slug).order("source"),
    supabase.from("v_client_report").select("*").eq("slug", slug),
  ]);
  if (!client) return (<><Header /><main><p>Client not found: {slug}</p></main></>);
  const sources = (client.client_sources || []).sort((a, b) => a.source.localeCompare(b.source) || String(a.external_id).localeCompare(String(b.external_id)));
  const gAdsScript = generateGoogleAdsScript(client.slug, client.name);

  // group performance rows by source, ordered
  const rows = report || [];
  const bySource = {};
  rows.forEach((r) => { (bySource[r.source] = bySource[r.source] || []).push(r); });
  const perfSources = SRC_ORDER.filter((s) => bySource[s]);
  const curMonth = rows.map((r) => r.cur_month).sort().at(-1);

  // headline KPI picks that actually have data
  const kpis = HEADLINE
    .map(([src, metric, label]) => {
      const row = (bySource[src] || []).find((r) => r.metric_name === metric);
      return row ? { label, row } : null;
    })
    .filter(Boolean);

  return (
    <>
      <Header />
      <main>
        <p className="muted"><a href="/clients">← Clients</a></p>
        <h1 style={{ margin: "4px 0" }}>{client.name || client.slug} <span className="muted" style={{ fontSize: 13 }}>· {client.status} · {client.timezone}</span></h1>

        {rows.length > 0 && (
          <>
            <h2>Performance <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· latest full data {fmtMonth(curMonth)} vs prior month</span></h2>
            {kpis.length > 0 && (
              <div className="kpis">
                {kpis.map(({ label, row }) => {
                  const d = fmtDelta(row.pct_change, row.direction);
                  return (
                    <div className="kpi" key={label}>
                      <div className="v">{fmtVal(row.cur_value, row.unit)}</div>
                      <div className="k">{label}</div>
                      <div className={`d delta ${d.cls}`}>{d.text} <span className="muted" style={{ fontWeight: 400 }}>MoM</span></div>
                    </div>
                  );
                })}
              </div>
            )}
            {perfSources.map((src) => (
              <div key={src} style={{ marginTop: 14 }}>
                <p className="srcgroup">{SRC_LABEL[src] || src}</p>
                <table>
                  <thead><tr>
                    <th>Metric</th>
                    <th className="num">{fmtMonth(bySource[src][0].cur_month)}</th>
                    <th className="num">Prev</th>
                    <th className="num">MoM</th>
                    <th className="num">Days</th>
                  </tr></thead>
                  <tbody>
                    {bySource[src].sort((a, b) => a.metric_name.localeCompare(b.metric_name)).map((r) => {
                      const d = fmtDelta(r.pct_change, r.direction);
                      return (
                        <tr key={r.metric_name}>
                          <td title={r.description || ""}>{r.metric_name.replace(/_/g, " ")}</td>
                          <td className="num">{fmtVal(r.cur_value, r.unit)}</td>
                          <td className="num muted">{r.prev_value == null ? "—" : fmtVal(r.prev_value, r.unit)}</td>
                          <td className={`num delta ${d.cls}`}>{d.text}</td>
                          <td className="num muted">{r.cur_days}{r.prev_days ? ` / ${r.prev_days}` : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Values are agg-aware (counts summed, rates averaged). "Days" = data days in current / prior month —
              partial months compare unequal spans.
            </p>
          </>
        )}

        <h2>Goals ({goals?.length ?? 0})</h2>
        <table>
          <thead><tr><th>Source</th><th>Metric</th><th className="num">Current</th><th className="num">Target</th><th className="num">%</th><th>Status</th><th className="num">Days left</th></tr></thead>
          <tbody>
            {(goals || []).map((g) => (
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

        <h2>Sources & freshness</h2>
        <table>
          <thead><tr><th>Source</th><th>External ID</th><th>Status</th><th>Last data</th><th className="num">Rows 30d</th><th>Flags</th></tr></thead>
          <tbody>
            {(sources || []).map((s) => {
              const p = (pipeline || []).find((x) => x.source === s.source);
              const flags = Object.entries(s.params || {})
                .filter(([k]) => ["confirmed", "unconfirmed", "brand", "mcp_pending", "deactivated", "note"].includes(k))
                .map(([k, v]) => `${k}:${v}`).join("  ");
              return (
                <tr key={s.id}>
                  <td>{s.source}{s.active ? "" : " (inactive)"}</td>
                  <td className="muted">{s.external_id}</td>
                  <td>{p ? <span className={`pill ${p.sync_status}`}>{p.sync_status?.replace("_", " ")}</span> : "—"}</td>
                  <td>{p?.last_metric_date || "—"}</td>
                  <td className="num">{num(p?.rows_30d)}</td>
                  <td className="muted" style={{ whiteSpace: "normal", fontSize: 12 }}>{flags}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2>Google Ads — account we don&apos;t manage</h2>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
          For a Google Ads account not under the Deksia MCC, generate this client-specific script and
          have whoever manages that account paste it into <strong>Google Ads → Tools → Bulk actions →
          Scripts → New script</strong>, then Authorize → Run once → schedule Daily. It reads yesterday&apos;s
          campaign metrics and sends them straight here (no spreadsheet). Replace{" "}
          <code>PASTE_INGEST_TOKEN</code> with the current ingest token before installing.
        </p>
        <ScriptBlock code={gAdsScript} filename={`google-ads-${client.slug}.js`} />

        <p className="muted" style={{ marginTop: 18 }}>Edit sources & goals — coming in P2/P3.</p>
      </main>
    </>
  );
}
