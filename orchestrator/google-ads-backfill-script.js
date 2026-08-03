/**
 * Deksia MCC — ONE-TIME BACKFILL for a date range (paste alongside nothing else;
 * run manually from the DEKSIA MCC, then delete or disable — do not schedule).
 *
 * Fills days the daily script never captured (e.g. July 1–5, 2026 before the direct
 * POST went live, or days an account reported late). Same ad-group grain and POST
 * path as the daily script; idempotent — safe over days that already exist.
 *
 * Set the three constants, Preview/Run once, watch the log for per-day 200s.
 * NOTE: Ads Scripts have a 30-minute limit — for long ranges run in chunks
 * (e.g. two weeks at a time).
 */
var INGEST_TOKEN   = "PASTE_INGEST_TOKEN";
var INGEST_URL     = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/ingest-metrics";
var BACKFILL_START = "2026-07-01"; // inclusive
var BACKFILL_END   = "2026-07-09"; // inclusive

function main() {
  var accounts = AdsManagerApp.accounts().get();
  while (accounts.hasNext()) {
    var acct = accounts.next();
    AdsManagerApp.select(acct);
    var cid = acct.getCustomerId();
    var d = new Date(BACKFILL_START + "T12:00:00Z");
    var end = new Date(BACKFILL_END + "T12:00:00Z");
    while (d <= end) {
      var day = Utilities.formatDate(d, "UTC", "yyyy-MM-dd");
      try { postDay_(cid, day); } catch (e) { Logger.log(cid + " " + day + " ERROR: " + e); }
      d = new Date(d.getTime() + 864e5);
    }
  }
}

function postDay_(cid, day) {
  var rows = [];
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
  if (!rows.length) { Logger.log(cid + " " + day + ": no rows"); return; }
  var res = UrlFetchApp.fetch(INGEST_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + INGEST_TOKEN },
    payload: JSON.stringify({ source: "google_ads", cid: cid, writer: "google-ads-backfill-script", rows: rows }),
    muteHttpExceptions: true,
  });
  Logger.log(cid + " " + day + " -> " + res.getResponseCode() + " (" + rows.length + " rows)");
}
