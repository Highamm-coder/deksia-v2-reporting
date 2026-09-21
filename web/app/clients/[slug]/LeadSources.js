"use client";
import { useState } from "react";
import { fmtVal, fmtMonth } from "../../../lib/format";

const CH_LABEL = { paid: "Paid", organic: "Organic", direct: "Direct / website",
  referral: "Referral", offline: "Offline", other: "Other", unclassified: "Unclassified" };
const CH_ORDER = ["paid", "organic", "direct", "referral", "offline", "other", "unclassified"];
const CH_PILL = { paid: "achieved", organic: "on_track", direct: "idle",
  referral: "idle", offline: "pending", other: "pending", unclassified: "stale" };
const n = (v) => (v == null ? 0 : Number(v));

// CallRail leads split by channel — CallRail attributes every call/form to a lead
// source ("Google Ads", "Google Organic", GMB…); we group those into channels.
// Click a channel to see the exact sources behind it.
export default function LeadSources({ rows }) {
  const list = rows || [];
  const [open, setOpen] = useState({});
  if (!list.length) return null;

  const byCh = {};
  list.forEach((r) => {
    const c = (byCh[r.channel] = byCh[r.channel] || { mqls: 0, qualified: 0, calls: 0, forms: 0, sources: [] });
    c.mqls += n(r.mqls); c.qualified += n(r.qualified); c.calls += n(r.calls); c.forms += n(r.forms);
    c.sources.push(r);
  });
  const channels = CH_ORDER.filter((c) => byCh[c]);
  const total = channels.reduce((t, c) => t + byCh[c].mqls, 0);

  return (
    <>
      <h2>Leads by channel <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>
        · {fmtMonth(list[0].month_start)} · CallRail lead source · click a channel for its sources</span></h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable report table"><table>
        <thead><tr>
          <th style={{ width: 20 }}></th><th>Channel</th>
          <th className="num">MQLs</th><th className="num">Share</th>
          <th className="num">Qualified</th><th className="num">Calls</th><th className="num">Forms</th>
        </tr></thead>
        <tbody>
          {channels.map((c) => {
            const d = byCh[c];
            const isOpen = !!open[c];
            return [
              <tr key={c} onClick={() => setOpen((o) => ({ ...o, [c]: !o[c] }))} style={{ cursor: "pointer" }}>
                <td className="muted" style={{ fontSize: 11 }}>{isOpen ? "▾" : "▸"}</td>
                <td><span className={`pill ${CH_PILL[c]}`}>{CH_LABEL[c] || c}</span>
                  <span className="muted" style={{ fontSize: 11 }}> · {d.sources.length} source{d.sources.length === 1 ? "" : "s"}</span></td>
                <td className="num" style={{ fontWeight: 700 }}>{fmtVal(d.mqls, "int")}</td>
                <td className="num muted">{total ? Math.round((d.mqls / total) * 100) + "%" : "—"}</td>
                <td className="num">{fmtVal(d.qualified, "int")}</td>
                <td className="num">{fmtVal(d.calls, "int")}</td>
                <td className="num">{fmtVal(d.forms, "int")}</td>
              </tr>,
              ...(isOpen ? d.sources.slice().sort((a, b) => n(b.mqls) - n(a.mqls)).map((s, i) => (
                <tr key={`${c}|${i}`} style={{ background: "rgba(255,255,255,.6)" }}>
                  <td></td>
                  <td style={{ paddingLeft: 26, whiteSpace: "normal", fontSize: 12 }}>{s.lead_source}</td>
                  <td className="num" style={{ fontSize: 12 }}>{fmtVal(s.mqls, "int")}</td>
                  <td></td>
                  <td className="num" style={{ fontSize: 12 }}>{fmtVal(s.qualified, "int")}</td>
                  <td className="num" style={{ fontSize: 12 }}>{fmtVal(s.calls, "int")}</td>
                  <td className="num" style={{ fontSize: 12 }}>{fmtVal(s.forms, "int")}</td>
                </tr>
              )) : []),
            ];
          })}
          <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
            <td></td><td>TOTAL</td>
            <td className="num">{fmtVal(total, "int")}</td>
            <td colSpan={4}></td>
          </tr>
        </tbody>
      </table></div>
      {byCh.unclassified && (
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          “Unclassified” = lead sources with no channel rule yet. Their MQLs are counted, just not
          attributed to paid or organic — expand to see which, and an admin can add a rule.
        </p>
      )}
    </>
  );
}
