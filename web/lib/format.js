// Shared metric formatting for the console.

const N = (v, d = 0) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

// Format a metric value for display, driven by its unit.
export function fmtVal(value, unit) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const v = Number(value);
  switch (unit) {
    case "usd": return "$" + N(v, 2);
    case "pct": return N(v, v < 10 ? 2 : 1) + "%";
    case "ratio": return N(v, 2) + "×";
    case "sec": {
      const s = Math.round(v);
      return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
    }
    default: return N(v, Number.isInteger(v) ? 0 : 1); // int / count / null unit
  }
}

// Month-over-month delta, colored by whether the move is *good* for that metric.
// `direction` = "increase" (up is good) | "decrease" (down is good, e.g. CPC/CPL).
export function fmtDelta(pctChange, direction = "increase") {
  if (pctChange == null || !Number.isFinite(Number(pctChange))) return { text: "—", cls: "flat" };
  const pct = Number(pctChange) * 100;
  if (Math.abs(pct) < 0.05) return { text: "0%", cls: "flat" };
  const up = pct > 0;
  const good = direction === "decrease" ? !up : up;
  return {
    text: (up ? "▲ " : "▼ ") + N(Math.abs(pct), Math.abs(pct) < 10 ? 1 : 0) + "%",
    cls: good ? "up" : "down",
  };
}

// "Jun 2026" from a YYYY-MM-DD month_start.
export function fmtMonth(s) {
  if (!s) return "—";
  const [y, m] = String(s).split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
}
