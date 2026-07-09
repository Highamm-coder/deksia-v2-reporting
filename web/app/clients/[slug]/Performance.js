"use client";
import { useEffect, useState } from "react";
import { fmtVal, fmtDelta, fmtMonth } from "../../../lib/format";

// The metrics that matter, in priority order — the default pinned set.
const PRIORITY = ["ctr", "spend", "cost_per_lead", "impressions", "reach", "leads", "qualified_leads", "mqls", "calls"];
const LABEL = {
  ctr: "CTR", spend: "Spend", cost_per_lead: "CPL", impressions: "Impressions", reach: "Reach",
  leads: "Leads", qualified_leads: "Qualified MQLs", mqls: "MQLs", calls: "Calls", forms: "Forms",
  clicks: "Clicks", link_clicks: "Link clicks", cpc: "CPC", conversions: "Conversions",
  conversion_action: "Conversion action", sessions: "Sessions", engaged_sessions: "Engaged sessions",
  key_events: "Key events", users: "Users", new_users: "New users", engagement: "Engagement",
  followers: "Followers", video_views: "Video views",
};
const SRC_LABEL = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", callrail: "CallRail", pages: "Facebook Pages", email: "Email", seo: "SEO", other: "Other" };
const SRC_ORDER = ["google_ads", "meta", "ga4", "callrail", "pages", "email", "seo", "other"];
const LS_KEY = "deksia_pinned_metrics";
const label = (m) => LABEL[m] || m.replace(/_/g, " ");
const prio = (m) => { const i = PRIORITY.indexOf(m); return i === -1 ? 99 : i; };

export default function Performance({ detail }) {
  // Deterministic first render (server + first client paint) = default set,
  // then hydrate from localStorage. Avoids hydration mismatch.
  const [pins, setPins] = useState(PRIORITY);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const s = localStorage.getItem(LS_KEY); if (s) setPins(JSON.parse(s)); } catch {}
    setReady(true);
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(LS_KEY, JSON.stringify(pins)); } catch {} }, [pins, ready]);

  const rows = detail || [];
  if (!rows.length) return null;
  const pinned = new Set(pins);
  const toggle = (m) => setPins((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));

  const curMonth = rows.map((r) => r.cur_month).sort().at(-1);

  // Highlighted strip: every row whose metric is pinned, ordered by priority.
  const highlights = rows
    .filter((r) => pinned.has(r.metric_name))
    .sort((a, b) => prio(a.metric_name) - prio(b.metric_name)
      || SRC_ORDER.indexOf(a.source) - SRC_ORDER.indexOf(b.source)
      || String(a.brand || "").localeCompare(String(b.brand || "")));

  // pinned metrics that have NO data for this client (honest gap note)
  const present = new Set(rows.map((r) => r.metric_name));
  const missing = pins.filter((m) => !present.has(m)).sort((a, b) => prio(a) - prio(b));

  // group full tables by source -> account
  const byAcct = {};
  rows.forEach((r) => {
    const s = (byAcct[r.source] = byAcct[r.source] || {});
    (s[r.account_ext_id] = s[r.account_ext_id] || { label: r.account_label, brand: r.brand, rows: [] }).rows.push(r);
  });
  const perfSources = SRC_ORDER.filter((s) => byAcct[s]);

  const Star = ({ m }) => (
    <button type="button" onClick={() => toggle(m)} title={pinned.has(m) ? "Unpin from highlights" : "Pin to highlights"}
      style={{ margin: 0, padding: "0 6px", background: "transparent", border: 0, cursor: "pointer",
        color: pinned.has(m) ? "var(--accent)" : "var(--line)", fontSize: 14, lineHeight: 1 }}>
      {pinned.has(m) ? "★" : "☆"}
    </button>
  );

  const acctSuffix = (src, acct, acctId) =>
    Object.keys(byAcct[src]).length > 1 ? ` · ${acct.brand || acct.label || acctId}` : "";

  return (
    <>
      <h2>Highlighted <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· {fmtMonth(curMonth)} vs prior month · pin ★ to add</span></h2>
      {highlights.length ? (
        <div className="kpis">
          {highlights.map((r) => {
            const d = fmtDelta(r.pct_change, r.direction);
            const multi = Object.keys(byAcct[r.source] || {}).length > 1;
            return (
              <div className="kpi" key={`${r.source}|${r.account_ext_id}|${r.metric_name}`} style={{ borderColor: "var(--accent)" }}>
                <div className="v">{fmtVal(r.cur_value, r.unit)}</div>
                <div className="k">
                  {label(r.metric_name)} <span className="muted">· {SRC_LABEL[r.source] || r.source}{multi && r.brand ? ` (${r.brand})` : ""}</span>
                </div>
                <div className={`d delta ${d.cls}`}>{d.text} <span className="muted" style={{ fontWeight: 400 }}>MoM</span></div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>No metrics pinned. Tap ★ on any row below to highlight it.</p>
      )}
      {missing.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Pinned but no data yet for this client: {missing.map(label).join(", ")}.
        </p>
      )}

      {perfSources.map((src) => {
        const accounts = Object.entries(byAcct[src])
          .sort(([, a], [, b]) => String(a.brand || a.label || "").localeCompare(String(b.brand || b.label || "")));
        return accounts.map(([acctId, acct]) => (
          <div key={`${src}|${acctId}`} style={{ marginTop: 14 }}>
            <p className="srcgroup">
              {SRC_LABEL[src] || src}
              {accounts.length > 1 && <span style={{ color: "var(--txt)" }}> — {acct.label || acctId}{acct.brand ? ` (${acct.brand})` : ""}</span>}
            </p>
            <table>
              <thead><tr>
                <th style={{ width: 24 }}></th>
                <th>Metric</th>
                <th className="num">{fmtMonth(acct.rows[0].cur_month)}</th>
                <th className="num">Prev</th>
                <th className="num">MoM</th>
                <th className="num">Days</th>
              </tr></thead>
              <tbody>
                {acct.rows.slice().sort((a, b) => (prio(a.metric_name) - prio(b.metric_name)) || a.metric_name.localeCompare(b.metric_name)).map((r) => {
                  const d = fmtDelta(r.pct_change, r.direction);
                  return (
                    <tr key={r.metric_name} style={pinned.has(r.metric_name) ? { background: "rgba(77,163,255,.06)" } : undefined}>
                      <td><Star m={r.metric_name} /></td>
                      <td title={r.description || ""}>{label(r.metric_name)}</td>
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
        ));
      })}
      <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Agg-aware (counts summed, rates as the platform reports them). Pins are saved in this browser.
      </p>
    </>
  );
}
