/**
 * Deksia MCC — daily Google Ads export to a Google Sheet (READ-ONLY behavior).
 * Campaign-level, per-account (no summing), with a conversion-action breakdown.
 * Paste as its OWN new script in the DEKSIA MCC (929-098-5791) Google Ads Scripts.
 *
 * Reads via GAQL (AdsApp.search — read only). Writes only to your Sheet.
 * No campaign edits, no UrlFetch/external calls, no mutations.
 *
 * Produces two tabs:
 *   Campaigns:    date, cid, account, campaign, impressions, clicks, cost, conversions
 *   Conversions:  date, cid, account, campaign, conversion_action, conversions
 *
 * Setup: put the Sheet URL in SHEET_URL; create as a NEW script (avoids the
 * "multiple main" clash); Authorize -> Preview; then Schedule daily.
 */
var SHEET_URL = "https://docs.google.com/spreadsheets/d/1cEIfUfd_AFd4r82qt9p9imuo7oaqcJqwgZXAGXRSzhU/edit";
var CAMP_TAB = "Campaigns";
var CONV_TAB = "Conversions";
var CAMP_HEADER = ["date","cid","account","campaign","impressions","clicks","cost","conversions"];
var CONV_HEADER = ["date","cid","account","campaign","conversion_action","conversions"];

function main() {
  var ss = SpreadsheetApp.openByUrl(SHEET_URL);
  var camp = tab_(ss, CAMP_TAB, CAMP_HEADER);
  var conv = tab_(ss, CONV_TAB, CONV_HEADER);

  var accounts = AdsManagerApp.accounts().get();
  var campRows = [], convRows = [];
  while (accounts.hasNext()) {
    var acct = accounts.next();
    AdsManagerApp.select(acct);
    var cid = acct.getCustomerId(), name = acct.getName();
    var day = Utilities.formatDate(new Date(Date.now() - 864e5), AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");

    // campaign-level performance
    var qa = "SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
             "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
    var ia = AdsApp.search(qa);
    while (ia.hasNext()) {
      var r = ia.next(), m = r.metrics || {};
      campRows.push([day, cid, name, r.campaign.name,
        Number(m.impressions||0), Number(m.clicks||0), Number(m.costMicros||0)/1e6, Number(m.conversions||0)]);
    }

    // conversions split by conversion action
    var qb = "SELECT campaign.name, segments.conversion_action_name, metrics.conversions " +
             "FROM campaign WHERE segments.date = '" + day + "' AND metrics.conversions > 0";
    var ib = AdsApp.search(qb);
    while (ib.hasNext()) {
      var r2 = ib.next();
      convRows.push([day, cid, name, r2.campaign.name,
        (r2.segments && r2.segments.conversionActionName) || "(unknown)", Number(r2.metrics.conversions||0)]);
    }
  }
  append_(camp, campRows);
  append_(conv, convRows);
  Logger.log("Campaigns: " + campRows.length + " rows · Conversions: " + convRows.length + " rows");
}

function tab_(ss, name, header) {
  var s = ss.getSheetByName(name) || ss.insertSheet(name);
  if (s.getLastRow() === 0) s.appendRow(header);
  return s;
}
function append_(sheet, rows) {
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
