import { fmtVal, fmtMonth } from "../../../lib/format";

const SRC_LABEL = { google_ads: "Google Ads", meta: "Meta" };
const SRC_ORDER = ["google_ads", "meta"];
const n = (v) => (v == null ? 0 : Number(v));

// Server component: campaigns running per client, grouped by source→account, with a TOTAL row.
export default function Campaigns({ campaigns }) {
  const rows = campaigns || [];
  if (!rows.length) return null;

  // group by source -> account
  const byAcct = {};
  rows.forEach((r) => {
    const s = (byAcct[r.source] = byAcct[r.source] || {});
    (s[r.account_ext_id] = s[r.account_ext_id] || { label: r.account_label, brand: r.brand, month: r.month_start, rows: [] }).rows.push(r);
  });
  const sources = SRC_ORDER.filter((s) => byAcct[s]);
  // "results" column = leads for Meta, conversions for Google Ads
  const resultKey = (src) => (src === "google_ads" ? "conversions" : "leads");

  return (
    <>
      <h2>Campaigns running <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>· latest full month, per account</span></h2>
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
          return (
            <div key={`${src}|${acctId}`} style={{ marginTop: 14 }}>
              <p className="srcgroup">
                {SRC_LABEL[src] || src}
                {multi && <span style={{ color: "var(--txt)" }}> — {acct.label || acctId}{acct.brand ? ` (${acct.brand})` : ""}</span>}
                <span className="muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · {fmtMonth(acct.month)} · {list.length} campaigns</span>
              </p>
              <table>
                <thead><tr>
                  <th>Campaign</th>
                  <th className="num">Spend</th>
                  <th className="num">Impressions</th>
                  <th className="num">Clicks</th>
                  <th className="num">{rk === "conversions" ? "Conv." : "Leads"}</th>
                </tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.campaign}>
                      <td style={{ whiteSpace: "normal" }}>{r.campaign}</td>
                      <td className="num">{fmtVal(r.spend, "usd")}</td>
                      <td className="num">{fmtVal(r.impressions, "int")}</td>
                      <td className="num">{fmtVal(r.clicks, "int")}</td>
                      <td className="num">{r[rk] == null ? "—" : fmtVal(r[rk], "int")}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                    <td>TOTAL</td>
                    <td className="num">{fmtVal(tot.spend, "usd")}</td>
                    <td className="num">{fmtVal(tot.impressions, "int")}</td>
                    <td className="num">{fmtVal(tot.clicks, "int")}</td>
                    <td className="num">{fmtVal(tot.results, "int")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        });
      })}
    </>
  );
}
