import { fmtVal, fmtMonth } from "../../../lib/format";

const n = (v) => (v == null ? 0 : Number(v));

// Google Ads conversion events by name (from conversion_action rows — the platform's
// own action names), per account, for the selected month. Campaign shown per row.
export default function Events({ events }) {
  const rows = events || [];
  if (!rows.length) return null;

  const byAcct = {};
  rows.forEach((r) => {
    (byAcct[r.account_ext_id] = byAcct[r.account_ext_id] || { label: r.account_label, brand: r.brand, month: r.month_start, rows: [] }).rows.push(r);
  });
  const accounts = Object.entries(byAcct)
    .sort(([, a], [, b]) => String(a.brand || a.label || "").localeCompare(String(b.brand || b.label || "")));

  return (
    <>
      <h2>Conversion events <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· Google Ads action names, {fmtMonth(rows[0].month_start)}</span></h2>
      {accounts.map(([acctId, acct]) => {
        const list = acct.rows.slice().sort((a, b) => n(b.conversions) - n(a.conversions));
        const total = list.reduce((t, r) => t + n(r.conversions), 0);
        return (
          <div key={acctId} style={{ marginTop: 14 }}>
            {accounts.length > 1 && (
              <p className="srcgroup">{acct.label || acctId}{acct.brand ? ` (${acct.brand})` : ""}</p>
            )}
            <table>
              <thead><tr><th>Event (conversion action)</th><th>Campaign</th><th className="num">Conversions</th></tr></thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={`${r.event}|${r.campaign}|${i}`}>
                    <td style={{ whiteSpace: "normal" }}>{r.event}</td>
                    <td className="muted" style={{ whiteSpace: "normal", fontSize: 12 }}>{r.campaign}</td>
                    <td className="num">{fmtVal(r.conversions, "int")}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                  <td>TOTAL</td><td></td>
                  <td className="num">{fmtVal(total, "int")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
