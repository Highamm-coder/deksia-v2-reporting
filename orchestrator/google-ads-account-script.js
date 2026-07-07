/**
 * Deksia — SINGLE-ACCOUNT Google Ads export to the shared Ledger Sheet.
 * For client accounts that are NOT under the DEKSIA MCC. Paste into THAT account's
 * own Google Ads Scripts (Tools -> Bulk actions -> Scripts), one per account.
 *
 * Identical output to the MCC script (same Campaigns/Conversions tabs, same shared
 * Sheet) — it just runs for the one account it's installed in instead of looping an MCC.
 * READ-ONLY behavior: GAQL reads + writes to your Sheet. No mutations, no UrlFetch.
 *
 * Prereqs:
 *   - You can add a script in this account (you manage its ads).
 *   - The Ledger Sheet below is shared (editor) with the Google user that authorizes this script.
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

  var acct = AdsApp.currentAccount();
  var cid = acct.getCustomerId(), name = acct.getName();
  var day = Utilities.formatDate(new Date(Date.now() - 864e5), acct.getTimeZone(), "yyyy-MM-dd");

  var campRows = [], convRows = [];

  var qa = "SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
           "FROM campaign WHERE segments.date = '" + day + "' AND metrics.impressions > 0";
  var ia = AdsApp.search(qa);
  while (ia.hasNext()) {
    var r = ia.next(), m = r.metrics || {};
    campRows.push([day, cid, name, r.campaign.name,
      Number(m.impressions||0), Number(m.clicks||0), Number(m.costMicros||0)/1e6, Number(m.conversions||0)]);
  }

  var qb = "SELECT campaign.name, segments.conversion_action_name, metrics.conversions " +
           "FROM campaign WHERE segments.date = '" + day + "' AND metrics.conversions > 0";
  var ib = AdsApp.search(qb);
  while (ib.hasNext()) {
    var r2 = ib.next();
    convRows.push([day, cid, name, r2.campaign.name,
      (r2.segments && r2.segments.conversionActionName) || "(unknown)", Number(r2.metrics.conversions||0)]);
  }

  append_(camp, campRows);
  append_(conv, convRows);
  Logger.log(name + " (" + cid + ") — Campaigns: " + campRows.length + " · Conversions: " + convRows.length);
}

function tab_(ss, name, header) {
  var s = ss.getSheetByName(name) || ss.insertSheet(name);
  if (s.getLastRow() === 0) s.appendRow(header);
  return s;
}
function append_(sheet, rows) {
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
