// Generates a per-client Google Ads Script for accounts Deksia does NOT manage
// (not under the MCC). The client pastes it into their own Google Ads → Scripts.
// Kept in sync with orchestrator/google-ads-account-script.js.
//
// The write token is intentionally left as a placeholder — we never render a secret
// into the browser. Whoever installs the script replaces PASTE_INGEST_TOKEN once.

const TEMPLATE = `/**
 * Deksia reporting — Google Ads daily export
 *   Client:  __CLIENT_NAME__
 *   Account: __ACCOUNT_LABEL__ (__ACCOUNT_ID__)
 * Paste into this account's Google Ads → Tools → Bulk actions → Scripts → New script,
 * click Authorize, Run once to test, then schedule it Daily.
 * Read-only on your ads account; the only external call is the POST to Deksia.
 *
 * Before installing: replace PASTE_INGEST_TOKEN below with the token Deksia gives you.
 */
var CLIENT_SLUG  = "__CLIENT_SLUG__";
// Sanity guard: this script belongs to ONE account. If it is pasted into the wrong
// one it stops instead of writing another client's numbers.
var EXPECT_CID   = "__ACCOUNT_ID__";
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";
var INGEST_URL   = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/ingest-metrics";

// Self-healing 3-day lookback: late-reporting days get caught on the next run and
// Google's restated conversions refresh. Upserts are idempotent - re-posting is safe.
var LOOKBACK_DAYS = 3;

function main() {
  var acct = AdsApp.currentAccount();
  var cid = acct.getCustomerId();
  if (EXPECT_CID && EXPECT_CID.replace(/\D/g, "") !== cid.replace(/\D/g, "")) {
    throw new Error("Wrong account: this script is for " + EXPECT_CID + " but is installed in " + cid
      + ". Ask Deksia for this account's script.");
  }
  for (var d = 1; d <= LOOKBACK_DAYS; d++) {
    postDay_(acct, cid, Utilities.formatDate(new Date(Date.now() - d * 864e5), acct.getTimeZone(), "yyyy-MM-dd"));
  }
}

function postDay_(acct, cid, day) {
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

// accountId/accountLabel make the script unique per account: the header names it and
// EXPECT_CID refuses to run if it's pasted into the wrong account.
export function generateGoogleAdsScript(slug, name, accountId = "", accountLabel = "") {
  const dashed = String(accountId).replace(/\D/g, "")
    .replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
  return TEMPLATE
    .replace(/__CLIENT_SLUG__/g, slug)
    .replace(/__CLIENT_NAME__/g, name || slug)
    .replace(/__ACCOUNT_ID__/g, dashed || "")
    .replace(/__ACCOUNT_LABEL__/g, accountLabel || dashed || "this account");
}
