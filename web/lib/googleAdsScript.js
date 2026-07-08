// Generates a per-client Google Ads Script for accounts Deksia does NOT manage
// (not under the MCC). The client pastes it into their own Google Ads → Scripts.
// Kept in sync with orchestrator/google-ads-account-script.js.
//
// The write token is intentionally left as a placeholder — we never render a secret
// into the browser. Whoever installs the script replaces PASTE_INGEST_TOKEN once.

const TEMPLATE = `/**
 * Deksia reporting — Google Ads daily export for: __CLIENT_NAME__
 * Paste into this account's Google Ads → Tools → Bulk actions → Scripts → New script,
 * click Authorize, Run once to test, then schedule it Daily.
 * Read-only on your ads account; the only external call is the POST to Deksia.
 *
 * Before installing: replace PASTE_INGEST_TOKEN below with the token Deksia gives you.
 */
var CLIENT_SLUG  = "__CLIENT_SLUG__";
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";
var INGEST_URL   = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/ingest-metrics";

function main() {
  var acct = AdsApp.currentAccount();
  var cid = acct.getCustomerId();
  var day = Utilities.formatDate(new Date(Date.now() - 864e5), acct.getTimeZone(), "yyyy-MM-dd");
  var rows = [];

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
  Logger.log(CLIENT_SLUG + " (" + cid + ") " + day + " -> " + res.getResponseCode() + " " + res.getContentText());
}
`;

export function generateGoogleAdsScript(slug, name) {
  return TEMPLATE
    .replace(/__CLIENT_SLUG__/g, slug)
    .replace(/__CLIENT_NAME__/g, name || slug);
}
