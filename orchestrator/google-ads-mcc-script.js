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

// Self-healing 3-day lookback: accounts that hadn't finished reporting when an
// earlier run fired get caught on the next run, and Google's restated conversions
// refresh too. Upserts are idempotent, so re-posting the same day is safe.
var LOOKBACK_DAYS = 3;

function postAccount_(acct) {
  var cid = acct.getCustomerId();
  for (var d = 1; d <= LOOKBACK_DAYS; d++) {
    var day = Utilities.formatDate(new Date(Date.now() - d * 864e5), acct.getTimeZone(), "yyyy-MM-dd");
    postAccountDay_(acct, cid, day);
  }
}

function postAccountDay_(acct, cid, day) {
  var rows = [];

  // ad-group-level metrics (finest grain that stays within Scripts limits;
  // ad-group rows sum exactly to the account's own campaign/account totals)
  var qa = "SELECT campaign.name, campaign.advertising_channel_type, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
           "FROM ad_group WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
  var seen2 = {};
  var ia = AdsApp.search(qa);
  while (ia.hasNext()) {
    var r = ia.next(), m = r.metrics || {}, campaign = r.campaign.name, adGroup = (r.adGroup && r.adGroup.name) || "";
    var ctype2 = String(r.campaign.advertisingChannelType || "").toLowerCase();
    seen2[campaign] = true;
    rows.push({ metric_name: "impressions", metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.impressions || 0), unit: "int", meta: { ctype: ctype2 } });
    rows.push({ metric_name: "clicks",      metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.clicks || 0), unit: "int", meta: { ctype: ctype2 } });
    rows.push({ metric_name: "spend",       metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.costMicros || 0) / 1e6, unit: "usd", meta: { ctype: ctype2 } });
    rows.push({ metric_name: "conversions", metric_date: day, account_ext_id: cid, entity: campaign, qualifier: adGroup, value: Number(m.conversions || 0), unit: "int", meta: { ctype: ctype2 } });
  }

  // conversions broken out by conversion action

  // Campaigns invisible at ad_group grain (Performance Max etc. use asset groups,
  // not ad groups) - emit campaign-level rows so their spend is not lost.
  var qc2 = "SELECT campaign.name, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
            "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
  var ic2 = AdsApp.search(qc2);
  while (ic2.hasNext()) {
    var r3 = ic2.next(), m3 = r3.metrics || {}, cname = r3.campaign.name;
    if (seen2[cname]) continue;
    var ctype = String(r3.campaign.advertisingChannelType || "campaign").toLowerCase();
    rows.push({ metric_name: "impressions", metric_date: day, account_ext_id: cid, entity: cname, qualifier: ctype, value: Number(m3.impressions || 0), unit: "int", meta: { ctype: ctype } });
    rows.push({ metric_name: "clicks",      metric_date: day, account_ext_id: cid, entity: cname, qualifier: ctype, value: Number(m3.clicks || 0), unit: "int", meta: { ctype: ctype } });
    rows.push({ metric_name: "spend",       metric_date: day, account_ext_id: cid, entity: cname, qualifier: ctype, value: Number(m3.costMicros || 0) / 1e6, unit: "usd", meta: { ctype: ctype } });
    rows.push({ metric_name: "conversions", metric_date: day, account_ext_id: cid, entity: cname, qualifier: ctype, value: Number(m3.conversions || 0), unit: "int", meta: { ctype: ctype } });
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
