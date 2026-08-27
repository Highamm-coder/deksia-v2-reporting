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

// Self-healing 3-day lookback: late-reporting days get caught on the next run and
// Google's restated conversions refresh. Upserts are idempotent — re-posting is safe.
var LOOKBACK_DAYS = 3;

function main() {
  var acct = AdsApp.currentAccount();
  var cid = acct.getCustomerId();
  for (var d = 1; d <= LOOKBACK_DAYS; d++) {
    postDay_(acct, cid, Utilities.formatDate(new Date(Date.now() - d * 864e5), acct.getTimeZone(), "yyyy-MM-dd"));
  }
}

function postDay_(acct, cid, day) {
  var rows = [];

  // ad-group-level metrics (finest grain within Scripts limits; sums to account totals)
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


  // ---- Meta parity: campaign-level RATES exactly as Google computes them ----
  // qualifier='rate' marks a distinct grain: these never mix with the ad-group
  // counts above (the views exclude them from sums) and drive the campaign table's
  // CTR / CPC / CPM columns, same as Meta.
  var qr = "SELECT campaign.name, metrics.ctr, metrics.average_cpc, metrics.average_cpm, " +
           "metrics.average_cost, metrics.cost_per_conversion, metrics.conversions_value, " +
           "metrics.interaction_rate, metrics.search_impression_share, " +
           "metrics.absolute_top_impression_percentage " +
           "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
  var ir = AdsApp.search(qr);
  while (ir.hasNext()) {
    var rr = ir.next(), mr = rr.metrics || {}, rn = rr.campaign.name;
    var putR = function (metric, value, unit) {
      if (value === null || value === undefined) return;
      rows.push({ metric_name: metric, metric_date: day, account_ext_id: cid,
        entity: rn, qualifier: "rate", value: Number(value), unit: unit });
    };
    putR("ctr", mr.ctr != null ? Number(mr.ctr) * 100 : null, "pct"); // Google returns a ratio
    putR("cpc", mr.averageCpc != null ? Number(mr.averageCpc) / 1e6 : null, "usd");
    putR("cpm", mr.averageCpm != null ? Number(mr.averageCpm) / 1e6 : null, "usd");
    putR("cost_per_conversion", mr.costPerConversion != null ? Number(mr.costPerConversion) / 1e6 : null, "usd");
    putR("conversions_value", mr.conversionsValue, "usd");
    putR("interaction_rate", mr.interactionRate != null ? Number(mr.interactionRate) * 100 : null, "pct");
    putR("impression_share", mr.searchImpressionShare != null ? Number(mr.searchImpressionShare) * 100 : null, "pct");
    putR("top_impression_pct", mr.absoluteTopImpressionPercentage != null ? Number(mr.absoluteTopImpressionPercentage) * 100 : null, "pct");
  }

  // ---- ACCOUNT-level rates (entity='' qualifier='') — mirrors Meta's account grain ----
  var qacc = "SELECT metrics.ctr, metrics.average_cpc, metrics.average_cpm, metrics.cost_per_conversion " +
             "FROM customer WHERE segments.date = '" + day + "'";
  var iacc = AdsApp.search(qacc);
  while (iacc.hasNext()) {
    var ra = iacc.next(), ma = ra.metrics || {};
    var putA = function (metric, value, unit) {
      if (value === null || value === undefined) return;
      rows.push({ metric_name: metric, metric_date: day, account_ext_id: cid,
        entity: "", qualifier: "", value: Number(value), unit: unit });
    };
    putA("ctr", ma.ctr != null ? Number(ma.ctr) * 100 : null, "pct");
    putA("cpc", ma.averageCpc != null ? Number(ma.averageCpc) / 1e6 : null, "usd");
    putA("cpm", ma.averageCpm != null ? Number(ma.averageCpm) / 1e6 : null, "usd");
    putA("cost_per_conversion", ma.costPerConversion != null ? Number(ma.costPerConversion) / 1e6 : null, "usd");
  }

  // ---- AD-level counts for the drill-down (Meta shows ad set > ad; this gives
  // ad group > ad). qualifier is prefixed 'ad:' so these are a separate grain and
  // are excluded from campaign/account sums — the ad-group rows remain the
  // authoritative counts, exactly as they have been all year.
  var qad = "SELECT campaign.name, ad_group.name, ad_group_ad.ad.name, ad_group_ad.ad.type, " +
            "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
            "FROM ad_group_ad WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
  var iad = AdsApp.search(qad);
  while (iad.hasNext()) {
    var ad = iad.next(), ma2 = ad.metrics || {};
    var adName = (ad.adGroupAd && ad.adGroupAd.ad && (ad.adGroupAd.ad.name || ad.adGroupAd.ad.type)) || "(unnamed ad)";
    var q = "ad:" + ((ad.adGroup && ad.adGroup.name) || "") + " \u203a " + adName;
    rows.push({ metric_name: "impressions", metric_date: day, account_ext_id: cid, entity: ad.campaign.name, qualifier: q, value: Number(ma2.impressions || 0), unit: "int" });
    rows.push({ metric_name: "clicks",      metric_date: day, account_ext_id: cid, entity: ad.campaign.name, qualifier: q, value: Number(ma2.clicks || 0), unit: "int" });
    rows.push({ metric_name: "spend",       metric_date: day, account_ext_id: cid, entity: ad.campaign.name, qualifier: q, value: Number(ma2.costMicros || 0) / 1e6, unit: "usd" });
    rows.push({ metric_name: "conversions", metric_date: day, account_ext_id: cid, entity: ad.campaign.name, qualifier: q, value: Number(ma2.conversions || 0), unit: "int" });
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
  Logger.log(CLIENT_SLUG + " (" + cid + ") " + day + " → " + res.getResponseCode() + " " + res.getContentText());
}
