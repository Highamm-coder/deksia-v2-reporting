import InfoDot from "../../_components/InfoDot";
import { fmtVal, fmtDelta, fmtMonth } from "../../../lib/format";

const SRC = { google_ads: "Google Ads", meta: "Meta", ga4: "GA4", callrail: "CallRail", pages: "Pages" };
const term = (t) => `${SRC[t.source] || t.source} ${String(t.metric).replace(/_/g, " ")}`;
const formula = (num, den) =>
  `(${(num || []).map(term).join(" + ")}) ÷ (${(den || []).map(term).join(" + ")})`;

// Deksia-computed metrics (custom formulas over platform-faithful additive inputs).
// Always labeled as computed; the ⓘ shows the formula AND the actual month numbers.
export default function Derived({ derived }) {
  const rows = (derived || []).filter((r) => r.cur_value != null);
  if (!rows.length) return null;
  return (
    <>
      <h2>Computed metrics <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· Deksia formulas, not platform numbers</span></h2>
      <div className="kpis">
        {rows.map((r) => {
          // for cost-type metrics down is good; otherwise up is good
          // A $ formula is assumed to be a cost (lower is better), which is what the unit
          // dropdown offers today ("cost per..."). A revenue-per-X formula would need its own
          // direction on derived_metrics before this holds.
          const d = fmtDelta(r.pct_change, r.unit === "usd" ? "decrease" : "increase");
          return (
            <div className="kpi" key={r.derived_id} style={{ borderStyle: "dashed" }}>
              <div className="v">{fmtVal(r.cur_value, r.unit)}</div>
              <div className="k">
                {r.label}
                <InfoDot title={`${r.label} — Deksia-computed`} lines={[
                  ["Formula", formula(r.numerator, r.denominator)],
                  ["This month", `${fmtVal(r.cur_num, "usd" === r.unit ? "usd" : "int")} ÷ ${fmtVal(r.cur_den, "int")} (${fmtMonth(String(r.cur_month).slice(0, 7))})`],
                  ["Basis", "Computed by Deksia from platform-reported values — this number does not appear in any platform."],
                ]} />
              </div>
              <div className={`d delta ${d.cls}`}>{d.text} <span className="muted" style={{ fontWeight: 400 }}>MoM</span></div>
            </div>
          );
        })}
      </div>
    </>
  );
}
