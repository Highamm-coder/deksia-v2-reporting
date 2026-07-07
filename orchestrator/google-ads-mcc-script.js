/**
 * Deksia MCC — daily direct POST to Deksia reporting (no spreadsheet).
 * Paste into the DEKSIA MCC (929-098-5791) Google Ads Scripts as the ONLY file.
 *
 * If you get "script has multiple main functions": your Scripts project has more than
 * one file (e.g. an old "Code.gs" and a "POST API.gs"), each with a main(). Delete the
 * extra file(s) so this is the single file in the project, then paste this in.
 *
 * Loops every account under the MCC, reads yesterday's campaign metrics, and POSTs them
 * straight into metrics_daily via ingest-metrics (idempotent). Read-only on the ads
 * accounts; the only external call is the POST to Deksia. Resolves each client by its
 * account CID against client_sources, so seed a google_ads client_source per client.
 *
 * Before running: set INGEST_TOKEN below to the current Deksia ingest token.
 */
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";
var INGEST_URL   = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/ingest-metrics";

function main() {
  var accounts = AdsManagerApp.accounts().get();
  while (accounts.hasNext()) {
    var acct = accounts.next();
    AdsManagerApp.select(acct);
    try {
      postAccount_(acct);
    } catch (e) {
      Logger.log(acct.getCustomerId() + " ERROR: " + e);
    }
  }
}

function postAccount_(acct) {
  var cid = acct.getCustomerId();
  var day = Utilities.formatDate(new Date(Date.now() - 864e5), acct.getTimeZone(), "yyyy-MM-dd");
  var rows = [];

  // campaign-level metrics
  var qa = "SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
           "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
  var ia = AdsApp.search(qa);
  while (ia.hasNext()) {
    var r = ia.next(), m = r.metrics || {}, campaign = r.campaign.name;
    rows.push({ metric_name: "impressions", metric_date: day, account_ext_id: cid, entity: campaign, value: Number(m.impressions || 0), unit: "int" });
    rows.push({ metric_name: "clicks",      metric_date: day, account_ext_id: cid, entity: campaign, value: Number(m.clicks || 0), unit: "int" });
    rows.push({ metric_name: "spend",       metric_date: day, account_ext_id: cid, entity: campaign, value: Number(m.costMicros || 0) / 1e6, unit: "usd" });
    rows.push({ metric_name: "conversions", metric_date: day, account_ext_id: cid, entity: campaign, value: Number(m.conversions || 0), unit: "int" });
  }

  // conversions broken out by conversion action
  var qb = "SELECT campaign.name, segments.conversion_action_name, metrics.conversions " +
           "FROM campaign WHERE segments.date = '" + day + "' AND metrics.conversions > 0";
  var ib = AdsApp.search(qb);
  while (ib.hasNext()) {
    var r2 = ib.next();
    rows.push({ metric_name: "conversion_action", metric_date: day, account_ext_id: cid,
      entity: r2.campaign.name,
      qualifier: (r2.segments && r2.segments.conversionActionName) || "(unknown)",
      value: Number(r2.metrics.conversions || 0), unit: "int" });
  }

  if (!rows.length) { Logger.log(cid + ": no rows for " + day); return; }

  var res = UrlFetchApp.fetch(INGEST_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + INGEST_TOKEN },
    payload: JSON.stringify({ source: "google_ads", cid: cid, rows: rows }),
    muteHttpExceptions: true,
  });
  Logger.log(cid + " " + day + " -> " + res.getResponseCode() + " (" + rows.length + " rows)");
}
