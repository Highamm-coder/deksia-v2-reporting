/**
 * Deksia MCC — daily metrics POST to Supabase ingest-metrics.
 * Paste into the DEKSIA MCC (929-098-5791) Google Ads Scripts, schedule daily.
 * Replaces the old "write to a Sheet" behavior: now POSTs JSON straight into
 * public.metrics_daily via the ingest-metrics edge function (idempotent upsert).
 *
 * Set the two constants below. INGEST_TOKEN is the Vault-stored bearer token.
 * The function resolves each account by its CID (digits) against client_sources,
 * so seed a google_ads client_source row per client with external_id = the CID.
 */
var INGEST_URL = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/ingest-metrics";
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";

function main() {
  var day = dateString_(-1); // yesterday in account timezone
  var accounts = AdsManagerApp.accounts().get();
  while (accounts.hasNext()) {
    var acct = accounts.next();
    AdsManagerApp.select(acct);
    var cid = acct.getCustomerId(); // e.g. "123-456-7890"
    var stats = AdWordsApp ? null : null;
    var sel = AdsApp.report(
      "SELECT Impressions, Clicks, Ctr, Cost, Conversions " +
      "FROM ACCOUNT_PERFORMANCE_REPORT DURING " + day.replace(/-/g, "") + "," + day.replace(/-/g, "")
    );
    var rows = sel.rows();
    var imp = 0, clk = 0, cost = 0, conv = 0;
    while (rows.hasNext()) {
      var r = rows.next();
      imp += Number(r["Impressions"]); clk += Number(r["Clicks"]);
      cost += Number(String(r["Cost"]).replace(/[^0-9.]/g, "")); conv += Number(r["Conversions"]);
    }
    var metricRows = [
      { metric_name: "impressions", metric_date: day, value: imp, unit: "int" },
      { metric_name: "clicks",      metric_date: day, value: clk, unit: "int" },
      { metric_name: "spend",       metric_date: day, value: cost, unit: "usd" },
      { metric_name: "conversions", metric_date: day, value: conv, unit: "int" }
    ];
    post_({ source: "google_ads", cid: cid, rows: metricRows });
  }
}

function post_(body) {
  var resp = UrlFetchApp.fetch(INGEST_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + INGEST_TOKEN },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  Logger.log(body.cid + " -> " + resp.getResponseCode() + " " + resp.getContentText());
}

function dateString_(offsetDays) {
  var tz = AdsApp.currentAccount().getTimeZone();
  var d = new Date(); d.setDate(d.getDate() + offsetDays);
  return Utilities.formatDate(d, tz, "yyyy-MM-dd");
}
