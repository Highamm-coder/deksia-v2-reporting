"use client";
import { useState } from "react";
import { fmtVal, fmtMonth } from "../../../lib/format";

const SRC_LABEL = { google_ads: "Google Ads", meta: "Meta" };
const SRC_ORDER = ["google_ads", "meta"];
const n = (v) => (v == null ? 0 : Number(v));

// Campaigns per client, grouped by source→account, with a TOTAL row. Click a
// campaign to expand its children: ad set › ad (Meta) or ad group (Google Ads) —
// counts only, since rates exist only at the grain the platform computes them.
export default function Campaigns({ campaigns, drill }) {
  const rows = campaigns || [];
  const [open, setOpen] = useState({});
  if (!rows.length) return null;

  const byAcct = {};
  rows.forEach((r) => {
    const s = (byAcct[r.source] = byAcct[r.source] || {});
    (s[r.account_ext_id] = s[r.account_ext_id] || { label: r.account_label, brand: r.brand, month: r.month_start, rows: [] }).rows.push(r);
  });
  const sources = SRC_ORDER.filter((s) => byAcct[s]);
  const resultKey = (src) => (src === "google_ads" ? "conversions" : "leads");
  const childrenOf = (src, acctId, campaign) =>
    (drill || []).filter((d) => d.source === src && d.account_ext_id === acctId && d.campaign === campaign)
      .sort((a, b) => n(b.spend) - n(a.spend));

  return (
    <>
      <h2>Campaigns <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· {fmtMonth(rows[0].month_start)}, per account · click a campaign for ad sets &amp; ads</span></h2>
      {sources.map((src) => {
        const accounts = Object.entries(byAcct[src])
          .sort(([, a], [, b]) => String(a.brand || a.label || "").localeCompare(String(b.brand || b.label || "")));
        const rk = resultKey(src);
        return accounts.map(([acctId, acct]) => {
          const list = acct.rows.slice().sort((a, b) => n(b.spend) - n(a.spend));
          const tot = list.reduce((t, r) => ({
            spend: t.spend + n(r.spend), impressions: t.impressions + n(r.impressions),
            clicks: t.clicks + n(r.clicks), results: t.results + n(r[rk]),
          }), { spend: 0, impressions: 0, clicks: 0, results: 0 });
          const multi = accounts.length > 1;
          // rate columns only where the platform reports them at campaign grain (Meta)
          const hasRates = list.some((r) => r.ctr != null || r.cpc != null);
          const hasReach = list.some((r) => r.reach != null);
          const hasCPA = list.some((r) => r.cost_per_conversion != null);
          const hasIS = list.some((r) => r.impression_share != null);
          const rateCols = 3 + (hasReach ? 1 : 0) + (hasCPA ? 1 : 0) + (hasIS ? 1 : 0);
          return (
            <div key={`${src}|${acctId}`} style={{ marginTop: 14 }}>
              <p className="srcgroup">
                {SRC_LABEL[src] || src}
                {multi && <span style={{ color: "var(--txt)" }}> — {acct.label || acctId}{acct.brand ? ` (${acct.brand})` : ""}</span>}
                <span className="muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · {list.length} campaigns</span>
              </p>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable report table"><table>
                <thead><tr>
                  <th style={{ width: 20 }}></th>
                  <th>Campaign</th>
                  <th className="num">Spend</th>
                  <th className="num">Impressions</th>
                  <th className="num">Clicks</th>
                  <th className="num">{rk === "conversions" ? "Conv." : "Leads"}</th>
                  {hasRates && <><th className="num">CTR</th><th className="num">CPC</th><th className="num">CPM</th>
                    {hasReach && <th className="num">Reach</th>}
                    {hasCPA && <th className="num">Cost / conv.</th>}
                    {hasIS && <th className="num">Impr. share</th>}</>}
                </tr></thead>
                <tbody>
                  {list.map((r) => {
                    const key = `${src}|${acctId}|${r.campaign}`;
                    const kids = childrenOf(src, acctId, r.campaign);
                    const isOpen = !!open[key];
                    return [
                      <tr key={key} onClick={() => kids.length && setOpen((o) => ({ ...o, [key]: !o[key] }))}
                        style={kids.length ? { cursor: "pointer" } : undefined}
                        title={kids.length ? `${kids.length} ${kids[0]?.is_ad_level ? "ads" : src === "meta" ? "ads" : "ad groups"}` : "no finer grain available"}>
                        <td className="muted" style={{ fontSize: 11 }}>{kids.length ? (isOpen ? "▾" : "▸") : ""}</td>
                        <td style={{ whiteSpace: "normal" }}>{r.campaign}</td>
                        <td className="num">{fmtVal(r.spend, "usd")}</td>
                        <td className="num">{fmtVal(r.impressions, "int")}</td>
                        <td className="num">{fmtVal(r.clicks, "int")}</td>
                        <td className="num">{r[rk] == null ? "—" : fmtVal(r[rk], "int")}</td>
                        {hasRates && <>
                          <td className="num">{r.ctr == null ? "—" : fmtVal(r.ctr, "pct")}</td>
                          <td className="num">{r.cpc == null ? "—" : fmtVal(r.cpc, "usd")}</td>
                          <td className="num">{r.cpm == null ? "—" : fmtVal(r.cpm, "usd")}</td>
                          {hasReach && <td className="num">{r.reach == null ? "—" : fmtVal(r.reach, "int")}</td>}
                          {hasCPA && <td className="num">{r.cost_per_conversion == null ? "—" : fmtVal(r.cost_per_conversion, "usd")}</td>}
                          {hasIS && <td className="num">{r.impression_share == null ? "—" : fmtVal(r.impression_share, "pct")}</td>}
                        </>}
                      </tr>,
                      ...(isOpen ? kids.map((d, i) => (
                        <tr key={`${key}|${i}`} style={{ background: "rgba(255,255,255,.6)" }}>
                          <td></td>
                          <td style={{ whiteSpace: "normal", paddingLeft: 26, fontSize: 12 }}>
                            {d.ad ? (
                              <>
                                <span className="muted">{d.ad_set}</span>
                                <span className="muted"> › </span>{d.ad}
                              </>
                            ) : d.ad_set}
                          </td>
                          <td className="num" style={{ fontSize: 12 }}>{fmtVal(d.spend, "usd")}</td>
                          <td className="num" style={{ fontSize: 12 }}>{fmtVal(d.impressions, "int")}</td>
                          <td className="num" style={{ fontSize: 12 }}>{fmtVal(d.clicks, "int")}</td>
                          <td className="num" style={{ fontSize: 12 }}>{d[rk] == null ? "—" : fmtVal(d[rk], "int")}</td>
                          {hasRates && <td className="muted" colSpan={rateCols} style={{ fontSize: 11, textAlign: "right" }}>rates reported at campaign level</td>}
                        </tr>
                      )) : []),
                    ];
                  })}
                  <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                    <td></td>
                    <td>TOTAL</td>
                    <td className="num">{fmtVal(tot.spend, "usd")}</td>
                    <td className="num">{fmtVal(tot.impressions, "int")}</td>
                    <td className="num">{fmtVal(tot.clicks, "int")}</td>
                    <td className="num">{fmtVal(tot.results, "int")}</td>
                    {hasRates && <td colSpan={rateCols}></td>}
                  </tr>
                </tbody>
              </table></div>
            </div>
          );
        });
      })}
    </>
  );
}
