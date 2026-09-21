"use client";
import { useEffect, useState } from "react";
import { fmtVal, fmtMonth, metricLabel, sourceLabel } from "../../../lib/format";

// Track a metric over time. Pick one from the rail on the left and it is drawn across every
// month we hold for this client, on a real pair of axes.
//
// Two deliberate constraints:
//  • Every series is per SOURCE. "Clicks" means Google Ads clicks or Meta clicks, never the two
//    added together — paid and organic clicks are different things and blending them would
//    invent a number the platform never reported.
//  • A month with no data stays a gap. The line breaks rather than joining across it, so a
//    connection that started mid-year does not look like a collapse to zero.
const KEY = "deksia_trend_metric";

// Axis ticks a human would have chosen: 1, 2 or 5 times a power of ten.
function niceTicks(lo, hi, target = 4) {
  const span = (hi - lo) || Math.abs(hi) || 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const out = [];
  for (let v = start, guard = 0; v <= hi + step * 0.5 && guard < 40; v += step, guard++) {
    out.push(Number(v.toFixed(10)));   // kill binary-float dust like 0.30000000000000004
  }
  return out.length >= 2 ? out : [lo, hi];
}

// Compact axis labels — "$1.2k", "150k", "2.4%". The full value is on the readout above.
function axisLabel(v, unit) {
  if (v == null || !isFinite(v)) return "";
  if (unit === "pct") return `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}%`;
  if (unit === "pos") return v.toFixed(1);
  const a = Math.abs(v);
  const money = unit === "usd" ? "$" : "";
  if (a >= 1e6) return `${money}${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${money}${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 10 || a === 0) return `${money}${Math.round(v)}`;
  return `${money}${v.toFixed(unit === "usd" ? 2 : 1)}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthTick = (ym, showYear) => {
  const [y, m] = String(ym).split("-");
  return showYear ? `${MON[Number(m) - 1]} ${String(y).slice(2)}` : MON[Number(m) - 1];
};

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

  const W = 760, H = 260, padL = 58, padR = 14, padT = 14, padB = 36;
  const dataMin = Math.min(...vals), dataMax = Math.max(...vals);
  // Counts start at zero so the eye reads magnitude; rates and positions keep a tight window,
  // because "average position moved 11.1 → 9.8" is invisible on a 0-based axis.
  const zeroBased = cur.agg !== "avg" && dataMin >= 0;
  const ticks = niceTicks(zeroBased ? 0 : dataMin, dataMax);
  const lo = Math.min(ticks[0], zeroBased ? 0 : dataMin);
  const hi = Math.max(ticks.at(-1), dataMax);
  const span = (hi - lo) || 1;
  const n = pts.length;
  const x = (i) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);

  let d = "", pen = false;
  pts.forEach((p, i) => {
    if (p.v == null || !isFinite(p.v)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)} `;
    pen = true;
  });

  // thin the month labels so they never collide
  const every = Math.ceil(n / 9);
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
        <div style={{ minWidth: 190, maxHeight: 260, overflowY: "auto", flex: "0 0 auto" }}>
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
        <div style={{ flex: "1 1 440px", minWidth: 320 }}>
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

            {/* y axis: gridline + value per tick */}
            {ticks.map((t) => (
              <g key={`y${t}`}>
                <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)}
                  stroke="var(--line)" strokeWidth="1" shapeRendering="crispEdges" />
                <text x={padL - 8} y={y(t) + 3.5} fontSize="11" fill="var(--muted)" textAnchor="end">
                  {axisLabel(t, cur.unit)}
                </text>
              </g>
            ))}

            {/* x axis line + month ticks */}
            <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB}
              stroke="var(--muted)" strokeWidth="1" shapeRendering="crispEdges" opacity=".45" />
            {pts.map((p, i) => {
              if (i % every !== 0 && i !== n - 1) return null;
              const isJan = String(p.m).endsWith("-01");
              return (
                <g key={`x${p.m}`}>
                  <line x1={x(i)} y1={H - padB} x2={x(i)} y2={H - padB + 4}
                    stroke="var(--muted)" strokeWidth="1" opacity=".45" shapeRendering="crispEdges" />
                  <text x={x(i)} y={H - padB + 17} fontSize="11" fill="var(--muted)" textAnchor="middle">
                    {monthTick(p.m, isJan || i === 0)}
                  </text>
                </g>
              );
            })}

            {/* hovered month guide */}
            {hover != null && pts[hover]?.v != null && (
              <line x1={x(hover)} y1={padT} x2={x(hover)} y2={H - padB}
                stroke="var(--accent)" strokeWidth="1" opacity=".25" />
            )}

            <path d={d.trim()} fill="none" stroke="var(--accent)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />

            {pts.map((p, i) => p.v == null || !isFinite(p.v) ? null : (
              <g key={p.m}>
                <circle cx={x(i)} cy={y(p.v)} r={hover === i ? 5 : 3} fill="var(--accent)" />
                {/* generous invisible hit area — the dots themselves are far too small to aim at */}
                <rect x={x(i) - 18} y={padT} width={36} height={H - padT - padB} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            ))}
          </svg>

          <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
            {cur.agg === "avg"
              ? "A rate, shown as the platform reports it each month — never summed. The scale is tightened to the range so small moves stay visible."
              : "Monthly totals as the platform reports them, on a zero-based scale."}
            {" "}Months with no data are left as gaps, not zeroes.
          </p>
        </div>
      </div>
    </section>
  );
}
