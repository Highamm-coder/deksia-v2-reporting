import { fmtVal, fmtMonth } from "../../../lib/format";

const n = (v) => (v == null ? 0 : Number(v));
const TOP = 20;

// Search Console top queries for the selected month, per property. Rows come from
// v_client_search_queries: clicks and impressions are the month's sums (the platform reports
// these for any date range); CTR and position are the average of the DAILY values the platform
// reported — labelled as such, never summed, never recomputed from clicks/impressions.
// Only stored at full depth (top 50 queries per day, 90-day horizon) — see client settings.
export default function TopQueries({ rows, fullDepth, month }) {
  const list = rows || [];
  if (!list.length) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        {fullDepth
          ? "Top queries arrive with the next daily pull (Search Console finalises three days late), and cover the last 90 days only."
          : "Top queries are stored at full metric depth only — an admin can switch it on under Settings → Metric depth."}
      </p>
    );
  }
  const byAcct = {};
  list.forEach((r) => {
    (byAcct[r.account_ext_id] = byAcct[r.account_ext_id] || { label: r.account_label || r.account_ext_id, rows: [] }).rows.push(r);
  });
  const multi = Object.keys(byAcct).length > 1;

  return (
    <>
      <h2>Top queries <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>
        · {fmtMonth(`${month}-01`)} · top {TOP} by clicks, as Search Console reports them</span></h2>
      {Object.entries(byAcct).sort(([, a], [, b]) => String(a.label).localeCompare(String(b.label))).map(([acctId, acct]) => {
        const top = acct.rows.slice().sort((a, b) => n(b.clicks) - n(a.clicks) || n(b.impressions) - n(a.impressions)).slice(0, TOP);
        return (
          <div className="card" key={acctId} style={{ maxWidth: "none", marginBottom: 12 }}>
            {multi && <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{acct.label}</div>}
            <div className="tablewrap"><table>
              <thead>
                <tr>
                  <th>Query</th>
                  <th style={{ textAlign: "right" }}>Clicks</th>
                  <th style={{ textAlign: "right" }}>Impressions</th>
                  <th style={{ textAlign: "right" }} title="Average of the daily CTR values Search Console reported for this query">CTR (avg of days)</th>
                  <th style={{ textAlign: "right" }} title="Average of the daily positions Search Console reported for this query">Position (avg of days)</th>
                  <th style={{ textAlign: "right" }} title="Days in the month this query appeared in the stored top 50">Days</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.query}>
                    <td style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.query}>{r.query}</td>
                    <td style={{ textAlign: "right" }}>{fmtVal(r.clicks, "int")}</td>
                    <td style={{ textAlign: "right" }}>{fmtVal(r.impressions, "int")}</td>
                    <td style={{ textAlign: "right" }}>{fmtVal(r.ctr_avg_of_days, "pct")}</td>
                    <td style={{ textAlign: "right" }}>{fmtVal(r.position_avg_of_days, "pos")}</td>
                    <td style={{ textAlign: "right" }} className="muted">{n(r.days)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              Stored as the top 50 queries per day; a query's month total counts only the days it made that list.
            </p>
          </div>
        );
      })}
    </>
  );
}
