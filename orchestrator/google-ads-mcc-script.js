/**
 * Deksia — MCC Google Ads → reporting (GENERATED, do not edit)
 *   Source of truth: orchestrator/gads/_body.js  ·  rebuild: node orchestrator/gads/build.mjs
 *
 * Install ONCE in the Deksia MCC (929-098-5791) → Tools → Bulk actions → Scripts,
 * paste the ingest token below, authorize, then schedule it HOURLY.
 *   • Every run posts the last 3 days for every account (late reporting + restatements).
 *   • Every run also drains up to 20 queued backfill days per account, so a year of
 *     history fills itself in over a few hours with nobody pasting date ranges.
 * Enqueue history from the console (Pipeline health → Google Ads backfill).
 */
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";

// ===== CANONICAL BODY — do not edit the generated scripts, edit this file =====
// Shared by the MCC script, the per-account script, and the console generator.
// Build with: node orchestrator/gads/build.mjs
//
// GRAIN CONTRACT (matches the reporting views):
//   qualifier = <ad group name>      -> authoritative counts (summed)
//   qualifier = "<channel type>"     -> campaign-level counts for PMax-style
//                                       campaigns that have no ad groups (summed)
//   qualifier = "rate"               -> campaign-level rates as Google computes them
//   qualifier = "ad:<group> › <ad>"  -> ad-level counts (drill only, NOT summed)
//   qualifier = "term:<query>"       -> search terms      (breakout, NOT summed)
//   qualifier = "kw:<keyword>"       -> keywords          (breakout, NOT summed)
//   qualifier = "ag:<asset group>"   -> PMax asset groups (breakout, NOT summed)
//   qualifier = "dev:<device>"       -> device split      (breakout, NOT summed)
//   qualifier = "net:<network>"      -> network split     (breakout, NOT summed)
//   qualifier = "age:<range>" / "gender:<g>" -> demographics (breakout, NOT summed)
// Anything with a prefix marker is a non-additive breakout the views exclude from
// totals, so adding detail can never change a headline number.

var INGEST_URL = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/ingest-metrics";
var QUEUE_URL  = "https://ykxauddrsnuwkvimkdhw.supabase.co/functions/v1/gads-queue";
var BATCH_DAYS = 20;   // days per queue run — stays inside the 30-minute script cap
var LOOKBACK_DAYS = 3; // daily mode: re-pull recent days (late reporting + restatements)

function post_(path, payload) {
  var res = UrlFetchApp.fetch(path, {
    method: "post", contentType: "application/json",
    headers: { Authorization: "Bearer " + INGEST_TOKEN },
    payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

// Ask the platform which days it still needs for this account.
function claimDays_(cid, limit) {
  var r = post_(QUEUE_URL, { action: "claim", cid: cid, limit: limit });
  if (r.code !== 200) { Logger.log("queue claim failed " + r.code + " " + r.text); return []; }
  try { return (JSON.parse(r.text).days || []); } catch (e) { return []; }
}
function completeDay_(cid, day, rows, ok, note) {
  post_(QUEUE_URL, { action: "complete", cid: cid, day: day, rows: rows, ok: ok, note: note || null });
}

function num_(v) { return v === null || v === undefined ? null : Number(v); }
function micros_(v) { return v === null || v === undefined ? null : Number(v) / 1e6; }
function pctOf_(v) { return v === null || v === undefined ? null : Number(v) * 100; }

// Build every row for one account-day. Returns the array of metric rows.
function buildRows_(cid, day) {
  var rows = [];
  var push = function (metric, entity, qualifier, value, unit, meta) {
    if (value === null || value === undefined) return;
    rows.push({ metric_name: metric, metric_date: day, account_ext_id: cid,
      entity: entity, qualifier: qualifier, value: Number(value), unit: unit,
      meta: meta || undefined });
  };
  var seenCampaign = {};

  // ---- 1. AD GROUP: the authoritative counts ----
  // NOT wrapped in try/catch on purpose: counts are load-bearing. If this fails the
  // day must end up 'errored' and be retried, never silently posted without spend.
  var it = AdsApp.search(
    "SELECT campaign.name, campaign.advertising_channel_type, ad_group.name, " +
    "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, " +
    "metrics.conversions_value, metrics.all_conversions, metrics.view_through_conversions " +
    "FROM ad_group WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
  while (it.hasNext()) {
    var r = it.next(), m = r.metrics || {}, camp = r.campaign.name;
    var ag = (r.adGroup && r.adGroup.name) || "";
    var ct = String(r.campaign.advertisingChannelType || "").toLowerCase();
    var mt = { ctype: ct };
    seenCampaign[camp] = true;
    push("impressions", camp, ag, num_(m.impressions), "int", mt);
    push("clicks", camp, ag, num_(m.clicks), "int", mt);
    push("spend", camp, ag, micros_(m.costMicros), "usd", mt);
    push("conversions", camp, ag, num_(m.conversions), "int", mt);
    push("conversions_value", camp, ag, num_(m.conversionsValue), "usd", mt);
    push("all_conversions", camp, ag, num_(m.allConversions), "int", mt);
    push("view_through_conversions", camp, ag, num_(m.viewThroughConversions), "int", mt);
  }

  // ---- 2. CAMPAIGN-level counts for campaigns with no ad groups (PMax etc.) ----
  var it2 = AdsApp.search(
    "SELECT campaign.name, campaign.advertising_channel_type, metrics.impressions, " +
    "metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, " +
    "metrics.all_conversions, metrics.view_through_conversions " +
    "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
  while (it2.hasNext()) {
    var r2 = it2.next(), m2 = r2.metrics || {}, c2 = r2.campaign.name;
    if (seenCampaign[c2]) continue;
    var ct2 = String(r2.campaign.advertisingChannelType || "campaign").toLowerCase();
    var mt2 = { ctype: ct2 };
    push("impressions", c2, ct2, num_(m2.impressions), "int", mt2);
    push("clicks", c2, ct2, num_(m2.clicks), "int", mt2);
    push("spend", c2, ct2, micros_(m2.costMicros), "usd", mt2);
    push("conversions", c2, ct2, num_(m2.conversions), "int", mt2);
    push("conversions_value", c2, ct2, num_(m2.conversionsValue), "usd", mt2);
    push("all_conversions", c2, ct2, num_(m2.allConversions), "int", mt2);
    push("view_through_conversions", c2, ct2, num_(m2.viewThroughConversions), "int", mt2);
  }

  // ---- 3. CAMPAIGN RATES + auction diagnostics + video + calls (qualifier='rate') ----
  try {
  var it3 = AdsApp.search(
    "SELECT campaign.name, metrics.ctr, metrics.average_cpc, metrics.average_cpm, " +
    "metrics.cost_per_conversion, metrics.cost_per_all_conversions, " +
    "metrics.conversions_from_interactions_rate, metrics.value_per_conversion, " +
    "metrics.interaction_rate, metrics.engagement_rate, " +
    "metrics.search_impression_share, metrics.search_budget_lost_impression_share, " +
    "metrics.search_rank_lost_impression_share, metrics.search_click_share, " +
    "metrics.absolute_top_impression_percentage, metrics.top_impression_percentage, " +
    "metrics.phone_calls, metrics.phone_impressions, metrics.phone_through_rate " +
    "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
  while (it3.hasNext()) {
    var r3 = it3.next(), m3 = r3.metrics || {}, c3 = r3.campaign.name;
    push("ctr", c3, "rate", pctOf_(m3.ctr), "pct");
    push("cpc", c3, "rate", micros_(m3.averageCpc), "usd");
    push("cpm", c3, "rate", micros_(m3.averageCpm), "usd");
    push("cost_per_conversion", c3, "rate", micros_(m3.costPerConversion), "usd");
    push("cost_per_all_conversions", c3, "rate", micros_(m3.costPerAllConversions), "usd");
    push("conversion_rate", c3, "rate", pctOf_(m3.conversionsFromInteractionsRate), "pct");
    push("value_per_conversion", c3, "rate", num_(m3.valuePerConversion), "usd");
    push("interaction_rate", c3, "rate", pctOf_(m3.interactionRate), "pct");
    push("engagement_rate", c3, "rate", pctOf_(m3.engagementRate), "pct");
    push("impression_share", c3, "rate", pctOf_(m3.searchImpressionShare), "pct");
    push("lost_is_budget", c3, "rate", pctOf_(m3.searchBudgetLostImpressionShare), "pct");
    push("lost_is_rank", c3, "rate", pctOf_(m3.searchRankLostImpressionShare), "pct");
    push("click_share", c3, "rate", pctOf_(m3.searchClickShare), "pct");
    push("top_impression_pct", c3, "rate", pctOf_(m3.absoluteTopImpressionPercentage), "pct");
    push("top_of_page_pct", c3, "rate", pctOf_(m3.topImpressionPercentage), "pct");
    push("phone_calls", c3, "rate", num_(m3.phoneCalls), "int");
    push("phone_impressions", c3, "rate", num_(m3.phoneImpressions), "int");
    push("phone_through_rate", c3, "rate", pctOf_(m3.phoneThroughRate), "pct");
  }
  } catch (e) { Logger.log("campaign rates query failed: " + e); }

  // ---- 3b. VIDEO metrics — availability varies by API version and campaign type,
  // so this is a separate guarded query. Tried widest-first, then a minimal fallback:
  // one unrecognized field must never cost us the core rates (it did once).
  var videoSets = [
    "metrics.video_views, metrics.video_view_rate, metrics.average_cpv, " +
      "metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, " +
      "metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate",
    "metrics.video_views, metrics.video_view_rate",
    "metrics.video_views",
  ];
  for (var vi = 0; vi < videoSets.length; vi++) {
    try {
      var itv = AdsApp.search("SELECT campaign.name, " + videoSets[vi] +
        " FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
      while (itv.hasNext()) {
        var rv = itv.next(), mv2 = rv.metrics || {}, cv = rv.campaign.name;
        push("video_views", cv, "rate", num_(mv2.videoViews), "int");
        push("video_view_rate", cv, "rate", pctOf_(mv2.videoViewRate), "pct");
        push("cpv", cv, "rate", micros_(mv2.averageCpv), "usd");
        push("video_p25_rate", cv, "rate", pctOf_(mv2.videoQuartileP25Rate), "pct");
        push("video_p50_rate", cv, "rate", pctOf_(mv2.videoQuartileP50Rate), "pct");
        push("video_p75_rate", cv, "rate", pctOf_(mv2.videoQuartileP75Rate), "pct");
        push("video_p100_rate", cv, "rate", pctOf_(mv2.videoQuartileP100Rate), "pct");
      }
      break;                       // this field set worked — stop trying narrower ones
    } catch (e) {
      if (vi === videoSets.length - 1) Logger.log("video metrics unavailable in this account: " + e);
    }
  }

  // ---- 4. ACCOUNT-level rates (entity='' qualifier='') ----
  try {
  var it4 = AdsApp.search(
    "SELECT metrics.ctr, metrics.average_cpc, metrics.average_cpm, " +
    "metrics.cost_per_conversion, metrics.conversions_from_interactions_rate " +
    "FROM customer WHERE segments.date = '" + day + "'");
  while (it4.hasNext()) {
    var m4 = (it4.next().metrics) || {};
    push("ctr", "", "", pctOf_(m4.ctr), "pct");
    push("cpc", "", "", micros_(m4.averageCpc), "usd");
    push("cpm", "", "", micros_(m4.averageCpm), "usd");
    push("cost_per_conversion", "", "", micros_(m4.costPerConversion), "usd");
    push("conversion_rate", "", "", pctOf_(m4.conversionsFromInteractionsRate), "pct");
  }
  } catch (e) { Logger.log("account rates unavailable: " + e); }

  // ---- 5. AD level (drill) ----
  try {
  var it5 = AdsApp.search(
    "SELECT campaign.name, ad_group.name, ad_group_ad.ad.name, ad_group_ad.ad.type, " +
    "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
    "FROM ad_group_ad WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
  while (it5.hasNext()) {
    var a = it5.next(), ma = a.metrics || {};
    var adName = (a.adGroupAd && a.adGroupAd.ad && (a.adGroupAd.ad.name || a.adGroupAd.ad.type)) || "(unnamed ad)";
    var q5 = "ad:" + ((a.adGroup && a.adGroup.name) || "") + " › " + adName;
    push("impressions", a.campaign.name, q5, num_(ma.impressions), "int");
    push("clicks", a.campaign.name, q5, num_(ma.clicks), "int");
    push("spend", a.campaign.name, q5, micros_(ma.costMicros), "usd");
    push("conversions", a.campaign.name, q5, num_(ma.conversions), "int");
  }
  } catch (e) { Logger.log("ad-level drill unavailable: " + e); }

  // ---- 6. SEARCH TERMS — the queries people actually typed ----
  try {
    var it6 = AdsApp.search(
      "SELECT campaign.name, search_term_view.search_term, metrics.impressions, " +
      "metrics.clicks, metrics.cost_micros, metrics.conversions " +
      "FROM search_term_view WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
    while (it6.hasNext()) {
      var t = it6.next(), mt6 = t.metrics || {};
      var term = (t.searchTermView && t.searchTermView.searchTerm) || "(unknown)";
      var q6 = "term:" + term;
      push("impressions", t.campaign.name, q6, num_(mt6.impressions), "int");
      push("clicks", t.campaign.name, q6, num_(mt6.clicks), "int");
      push("spend", t.campaign.name, q6, micros_(mt6.costMicros), "usd");
      push("conversions", t.campaign.name, q6, num_(mt6.conversions), "int");
    }
  } catch (e) { Logger.log("search_term_view skipped: " + e); }

  // ---- 7. KEYWORDS + quality score ----
  try {
    var it7 = AdsApp.search(
      "SELECT campaign.name, ad_group_criterion.keyword.text, " +
      "ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, " +
      "ad_group_criterion.quality_info.creative_quality_score, " +
      "ad_group_criterion.quality_info.post_click_quality_score, " +
      "ad_group_criterion.quality_info.search_predicted_ctr, " +
      "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
      "FROM keyword_view WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
    while (it7.hasNext()) {
      var k = it7.next(), mk = k.metrics || {};
      var kw = (k.adGroupCriterion && k.adGroupCriterion.keyword) || {};
      var q7 = "kw:" + (kw.text || "(unknown)") + (kw.matchType ? " [" + kw.matchType + "]" : "");
      push("impressions", k.campaign.name, q7, num_(mk.impressions), "int");
      push("clicks", k.campaign.name, q7, num_(mk.clicks), "int");
      push("spend", k.campaign.name, q7, micros_(mk.costMicros), "usd");
      push("conversions", k.campaign.name, q7, num_(mk.conversions), "int");
      var qi = k.adGroupCriterion && k.adGroupCriterion.qualityInfo;
      if (qi && qi.qualityScore) push("quality_score", k.campaign.name, q7, num_(qi.qualityScore), "int");
      // Google's three quality components are enum strings (BELOW_AVERAGE etc.) —
      // carry them as text in meta rather than inventing a numeric score.
      if (qi && (qi.creativeQualityScore || qi.postClickQualityScore || qi.searchPredictedCtr)) {
        rows.push({ metric_name: "quality_components", metric_date: day, account_ext_id: cid,
          entity: k.campaign.name, qualifier: q7, value: 1, unit: "int",
          meta: { ad_relevance: qi.creativeQualityScore || null,
                  landing_page: qi.postClickQualityScore || null,
                  expected_ctr: qi.searchPredictedCtr || null } });
      }
    }
  } catch (e) { Logger.log("keyword_view skipped: " + e); }

  // ---- 8. PMax ASSET GROUPS — the only way inside Performance Max ----
  try {
    var it8 = AdsApp.search(
      "SELECT campaign.name, asset_group.name, metrics.impressions, metrics.clicks, " +
      "metrics.cost_micros, metrics.conversions, metrics.conversions_value " +
      "FROM asset_group WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
    while (it8.hasNext()) {
      var g = it8.next(), mg = g.metrics || {};
      var q8 = "ag:" + ((g.assetGroup && g.assetGroup.name) || "(unnamed)");
      push("impressions", g.campaign.name, q8, num_(mg.impressions), "int");
      push("clicks", g.campaign.name, q8, num_(mg.clicks), "int");
      push("spend", g.campaign.name, q8, micros_(mg.costMicros), "usd");
      push("conversions", g.campaign.name, q8, num_(mg.conversions), "int");
      push("conversions_value", g.campaign.name, q8, num_(mg.conversionsValue), "usd");
    }
  } catch (e) { Logger.log("asset_group skipped: " + e); }

  // ---- 9. DEVICE + NETWORK splits ----
  try {
    var it9 = AdsApp.search(
      "SELECT campaign.name, segments.device, metrics.impressions, metrics.clicks, " +
      "metrics.cost_micros, metrics.conversions " +
      "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
    while (it9.hasNext()) {
      var d9 = it9.next(), m9 = d9.metrics || {};
      var q9 = "dev:" + String((d9.segments && d9.segments.device) || "UNKNOWN").toLowerCase();
      push("impressions", d9.campaign.name, q9, num_(m9.impressions), "int");
      push("clicks", d9.campaign.name, q9, num_(m9.clicks), "int");
      push("spend", d9.campaign.name, q9, micros_(m9.costMicros), "usd");
      push("conversions", d9.campaign.name, q9, num_(m9.conversions), "int");
    }
  } catch (e) { Logger.log("device segment skipped: " + e); }
  try {
    var it10 = AdsApp.search(
      "SELECT campaign.name, segments.ad_network_type, metrics.impressions, metrics.clicks, " +
      "metrics.cost_micros, metrics.conversions " +
      "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
    while (it10.hasNext()) {
      var n10 = it10.next(), m10 = n10.metrics || {};
      var q10 = "net:" + String((n10.segments && n10.segments.adNetworkType) || "UNKNOWN").toLowerCase();
      push("impressions", n10.campaign.name, q10, num_(m10.impressions), "int");
      push("clicks", n10.campaign.name, q10, num_(m10.clicks), "int");
      push("spend", n10.campaign.name, q10, micros_(m10.costMicros), "usd");
      push("conversions", n10.campaign.name, q10, num_(m10.conversions), "int");
    }
  } catch (e) { Logger.log("network segment skipped: " + e); }

  // ---- 10. DEMOGRAPHICS (parity with Meta's age/gender breakdowns) ----
  try {
    var it11 = AdsApp.search(
      "SELECT campaign.name, ad_group_criterion.age_range.type, metrics.impressions, " +
      "metrics.clicks, metrics.cost_micros, metrics.conversions " +
      "FROM age_range_view WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
    while (it11.hasNext()) {
      var ag11 = it11.next(), m11 = ag11.metrics || {};
      var t11 = (ag11.adGroupCriterion && ag11.adGroupCriterion.ageRange && ag11.adGroupCriterion.ageRange.type) || "UNKNOWN";
      var q11 = "age:" + String(t11).replace(/^AGE_RANGE_/, "").toLowerCase();
      push("impressions", ag11.campaign.name, q11, num_(m11.impressions), "int");
      push("clicks", ag11.campaign.name, q11, num_(m11.clicks), "int");
      push("spend", ag11.campaign.name, q11, micros_(m11.costMicros), "usd");
      push("conversions", ag11.campaign.name, q11, num_(m11.conversions), "int");
    }
  } catch (e) { Logger.log("age_range_view skipped: " + e); }
  try {
    var it12 = AdsApp.search(
      "SELECT campaign.name, ad_group_criterion.gender.type, metrics.impressions, " +
      "metrics.clicks, metrics.cost_micros, metrics.conversions " +
      "FROM gender_view WHERE segments.date = '" + day + "' AND metrics.impressions > 0");
    while (it12.hasNext()) {
      var g12 = it12.next(), m12 = g12.metrics || {};
      var t12 = (g12.adGroupCriterion && g12.adGroupCriterion.gender && g12.adGroupCriterion.gender.type) || "UNKNOWN";
      var q12 = "gender:" + String(t12).replace(/^GENDER_/, "").toLowerCase();
      push("impressions", g12.campaign.name, q12, num_(m12.impressions), "int");
      push("clicks", g12.campaign.name, q12, num_(m12.clicks), "int");
      push("spend", g12.campaign.name, q12, micros_(m12.costMicros), "usd");
      push("conversions", g12.campaign.name, q12, num_(m12.conversions), "int");
    }
  } catch (e) { Logger.log("gender_view skipped: " + e); }

  // ---- 11. CONVERSION ACTIONS (name + category) ----
  try {
  var it13 = AdsApp.search(
    "SELECT campaign.name, segments.conversion_action_name, " +
    "segments.conversion_action_category, metrics.conversions, metrics.conversions_value " +
    "FROM campaign WHERE segments.date = '" + day + "' AND metrics.conversions > 0");
  while (it13.hasNext()) {
    var ca = it13.next(), sc = ca.segments || {}, mc = ca.metrics || {};
    var name = sc.conversionActionName || "(unknown)";
    var cat = sc.conversionActionCategory ? String(sc.conversionActionCategory).toLowerCase() : null;
    push("conversion_action", ca.campaign.name, name, num_(mc.conversions), "int", cat ? { category: cat } : undefined);
    push("conversion_action_value", ca.campaign.name, name, num_(mc.conversionsValue), "usd", cat ? { category: cat } : undefined);
  }
  } catch (e) { Logger.log("conversion actions unavailable: " + e); }

  return rows;
}

// Post one account-day in chunks (row counts are much larger now).
function postDay_(cid, day) {
  var rows;
  try { rows = buildRows_(cid, day); }
  catch (e) { Logger.log(cid + " " + day + " BUILD FAILED: " + e); return -1; }
  if (!rows.length) { Logger.log(cid + " " + day + ": no rows"); return 0; }
  var CHUNK = 1200, sent = 0;
  for (var i = 0; i < rows.length; i += CHUNK) {
    var r = post_(INGEST_URL, {
      source: "google_ads", cid: cid, writer: "google-ads-script",
      client_slug: typeof CLIENT_SLUG !== "undefined" ? CLIENT_SLUG : undefined,
      rows: rows.slice(i, i + CHUNK),
    });
    if (r.code !== 200) { Logger.log(cid + " " + day + " POST " + r.code + " " + r.text.slice(0, 200)); return -1; }
    sent += Math.min(CHUNK, rows.length - i);
  }
  Logger.log(cid + " " + day + " -> " + sent + " rows");
  return sent;
}

// Daily mode: recent days. Queue mode: drain whatever the platform still needs.
function runAccount_(cid) {
  var i, day;
  for (i = 1; i <= LOOKBACK_DAYS; i++) {
    day = Utilities.formatDate(new Date(Date.now() - i * 864e5),
      AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");
    postDay_(cid, day);
  }
  var queued = claimDays_(cid, BATCH_DAYS);
  if (queued.length) Logger.log(cid + ": draining " + queued.length + " queued day(s)");
  for (i = 0; i < queued.length; i++) {
    day = queued[i];
    var n = postDay_(cid, day);
    completeDay_(cid, day, n < 0 ? 0 : n, n >= 0, n < 0 ? "post failed" : null);
  }
}


function main() {
  var accounts = AdsManagerApp.accounts().get();
  while (accounts.hasNext()) {
    var acct = accounts.next();
    AdsManagerApp.select(acct);
    try { runAccount_(acct.getCustomerId()); }
    catch (e) { Logger.log(acct.getCustomerId() + " FAILED: " + e); }
  }
}
