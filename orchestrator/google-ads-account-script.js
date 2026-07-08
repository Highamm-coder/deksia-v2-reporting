/**
 * Deksia — SINGLE-ACCOUNT Google Ads → Deksia reporting (direct POST, no spreadsheet).
 * For a client's Google Ads account that is NOT under the Deksia MCC (we don't manage it).
 *
 * The client (or you, with access) pastes this into THAT account's Google Ads Scripts
 * (Tools → Bulk actions → Scripts → New script), authorizes it, and schedules it daily.
 * It reads yesterday's campaign metrics and POSTs them straight into Deksia's reporting
 * database. Read-only on the ads account; the only external call is the POST to Deksia.
 *
 * Two values are filled in per client:
 *   CLIENT_SLUG  — which Deksia client this account's data belongs to (baked in below).
 *   INGEST_TOKEN — Deksia's write token; paste it in before installing (kept out of
 *                  source on purpose). Ask Deksia for the current value.
 */
var CLIENT_SLUG  = "__CLIENT_SLUG__";
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";
var INGEST_URL   = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/ingest-metrics";

function main() {
  var acct = AdsApp.currentAccount();
  var cid = acct.getCustomerId();
  var day = Utilities.formatDate(new Date(Date.now() - 864e5), acct.getTimeZone(), "yyyy-MM-dd");
  var rows = [];

  // ad-group-level metrics (finest grain within Scripts limits; sums to account totals)
  var qa = "SELECT campaign.name, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
           "FROM ad_group WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
  var ia = AdsApp.search(qa);
  while (ia.hasNext()) {
    var r = ia.next(), m = r.metrics || {}, campaign = r.campaign.name, adGroup = (r.adGroup && r.adGroup.name) || "";
    rows.push({ metric_name: "impressions", metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.impressions || 0), unit: "int" });
    rows.push({ metric_name: "clicks",      metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.clicks || 0), unit: "int" });
    rows.push({ metric_name: "spend",       metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.costMicros || 0) / 1e6, unit: "usd" });
    rows.push({ metric_name: "conversions", metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.conversions || 0), unit: "int" });
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

  if (!rows.length) { Logger.log(CLIENT_SLUG + " (" + cid + "): no rows for " + day); return; }

  var res = UrlFetchApp.fetch(INGEST_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + INGEST_TOKEN },
    payload: JSON.stringify({ source: "google_ads", client_slug: CLIENT_SLUG, cid: cid, rows: rows }),
    muteHttpExceptions: true,
  });
  Logger.log(CLIENT_SLUG + " (" + cid + ") " + day + " → " + res.getResponseCode() + " " + res.getContentText());
}
