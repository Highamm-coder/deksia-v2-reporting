"use client";
import { useEffect, useState } from "react";
import { fmtVal, fmtMonth, metricLabel, sourceLabel } from "../../../lib/format";

// Track a metric over time. Pick one from the rail on the left and it is drawn across every
// month we hold for this client.
//
// Two deliberate constraints:
//  • Every series is per SOURCE. "Clicks" means Google Ads clicks or Meta clicks, never the two
//    added together — paid and organic clicks are different things and blending them would
//    invent a number the platform never reported.
//  • A month with no data stays a gap. The line breaks rather than joining across it, so a
//    connection that started mid-year does not look like a collapse to zero.
const KEY = "deksia_trend_metric";

export default function MetricTrend({ series }) {
  const list = series || [];
  const [sel, setSel] = useState(list[0]?.key || null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && list.some((s) => s.key === saved)) setSel(saved);
    } catch { /* private window, or storage blocked — the default stands */ }
  }, [list]);

  const choose = (k) => {
    setSel(k);
    try { localStorage.setItem(KEY, k); } catch { /* not worth failing over */ }
  };

  if (!list.length) return null;
  const cur = list.find((s) => s.key === sel) || list[0];
  const pts = cur.points || [];
  const vals = pts.map((p) => p.v).filter((v) => v != null && isFinite(v));
  if (vals.length < 2) return null;

  const W = 720, H = 210, padL = 8, padR = 8, padT = 16, padB = 26;
  const min = Math.min(...vals), max = Math.max(...vals);
  const lo = Math.min(min, 0) === 0 && min >= 0 ? 0 : min;   // start at zero when the metric is non-negative
  const span = (max - lo) || 1;
  const n = pts.length;
  const x = (i) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);

  let d = "", pen = false;
  pts.forEach((p, i) => {
    if (p.v == null || !isFinite(p.v)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)} `;
    pen = true;
  });

  const shown = hover != null && pts[hover]?.v != null ? pts[hover] : pts.filter((p) => p.v != null).at(-1);

  return (
    <section style={{ margin: "6px 0 10px" }}>
      <h2 style={{ color: "var(--accent)" }}>Tracked metric{" "}
        <span className="muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
          · pick one to follow it month by month
        </span>
      </h2>
      <div className="card" style={{ maxWidth: "none", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* selector */}
        <div style={{ minWidth: 190, maxHeight: 250, overflowY: "auto", flex: "0 0 auto" }}>
          {list.map((s) => {
            const on = s.key === cur.key;
            return (
              <button key={s.key} type="button" onClick={() => choose(s.key)} aria-pressed={on}
                title={s.description || ""}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                  margin: "0 0 2px", padding: "6px 8px", borderRadius: 8, cursor: "pointer",
                  background: on ? "var(--accent-soft)" : "transparent", color: "var(--txt)",
                  border: 0, font: "inherit", fontSize: 13, fontWeight: on ? 700 : 400,
                }}>
                <span aria-hidden style={{
                  width: 10, height: 10, borderRadius: 999, flex: "0 0 auto",
                  border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`,
                  background: on ? "var(--accent)" : "transparent",
                }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {metricLabel(s.metric)}
                  <span className="muted" style={{ fontWeight: 400 }}> · {sourceLabel(s.source)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* chart */}
        <div style={{ flex: "1 1 420px", minWidth: 300 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {fmtVal(shown?.v, cur.unit)}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {metricLabel(cur.metric)} · {sourceLabel(cur.source)} · {fmtMonth(`${shown?.m}-01`)}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
            aria-label={`${metricLabel(cur.metric)} for ${sourceLabel(cur.source)}, ${fmtMonth(`${pts[0]?.m}-01`)} to ${fmtMonth(`${pts.at(-1)?.m}-01`)}`}
            style={{ display: "block", marginTop: 4, overflow: "visible" }}>
            <line x1={padL} y1={y(lo)} x2={W - padR} y2={y(lo)} stroke="var(--line)" strokeWidth="1" />
            <path d={d.trim()} fill="none" stroke="var(--accent)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => p.v == null || !isFinite(p.v) ? null : (
              <g key={p.m}>
                <circle cx={x(i)} cy={y(p.v)} r={hover === i ? 5 : 3} fill="var(--accent)" />
                {/* generous invisible hit area — the dots themselves are far too small to aim at */}
                <rect x={x(i) - 16} y={0} width={32} height={H} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            ))}
            <text x={padL} y={H - 8} fontSize="11" fill="var(--muted)">{fmtMonth(`${pts[0]?.m}-01`)}</text>
            <text x={W - padR} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor="end">
              {fmtMonth(`${pts.at(-1)?.m}-01`)}
            </text>
          </svg>
          <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
            {cur.agg === "avg"
              ? "A rate, shown as the platform reports it each month — never summed."
              : "Monthly totals as the platform reports them."}
            {" "}Months with no data are left as gaps, not zeroes.
          </p>
        </div>
      </div>
    </section>
  );
}
