// Tiny dependency-free trend line. `points` = [{ m: 'YYYY-MM', v: number|null }] in
// chronological order; plots only real values (gaps stay gaps — platform-faithful).
export default function Sparkline({ points, width = 110, height = 26 }) {
  const vals = (points || []).map((p) => p.v).filter((v) => v != null && isFinite(v));
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const n = points.length;
  const xy = points.map((p, i) =>
    p.v == null || !isFinite(p.v) ? null
      : [(n === 1 ? 0.5 : i / (n - 1)) * (width - 6) + 3,
         height - 3 - ((p.v - min) / span) * (height - 8)]);
  let d = "", pen = false;
  xy.forEach((c) => {
    if (!c) { pen = false; return; }
    d += `${pen ? "L" : "M"}${c[0].toFixed(1)},${c[1].toFixed(1)} `;
    pen = true;
  });
  const last = [...xy].reverse().find(Boolean);
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block", marginTop: 6 }}>
      <path d={d.trim()} fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity=".5" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.4" fill="currentColor" />}
    </svg>
  );
}
