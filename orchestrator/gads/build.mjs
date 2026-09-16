#!/usr/bin/env node
// Assembles the three Google Ads Script variants from orchestrator/gads/_body.js
// so the metric logic has ONE source of truth (four hand-maintained copies drifted).
//   node orchestrator/gads/build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const body = readFileSync(new URL("./_body.js", import.meta.url), "utf8");

const MCC = `/**
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

${body}

function main() {
  var accounts = AdsManagerApp.accounts().get();
  while (accounts.hasNext()) {
    var acct = accounts.next();
    AdsManagerApp.select(acct);
    try { runAccount_(acct.getCustomerId()); }
    catch (e) { Logger.log(acct.getCustomerId() + " FAILED: " + e); }
  }
}
`;

const ACCOUNT = `/**
 * Deksia — SINGLE-ACCOUNT Google Ads → reporting (GENERATED, do not edit)
 *   Source of truth: orchestrator/gads/_body.js  ·  rebuild: node orchestrator/gads/build.mjs
 *
 * For an account NOT under the Deksia MCC. Paste into THAT account's Google Ads →
 * Tools → Bulk actions → Scripts → New script, set the two values below, authorize,
 * then schedule HOURLY (it posts recent days and drains queued backfill days).
 */
var CLIENT_SLUG  = "__CLIENT_SLUG__";
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";

${body}

function main() {
  var acct = AdsApp.currentAccount();
  runAccount_(acct.getCustomerId());
}
`;

const TEMPLATE = `/**
 * Deksia reporting — Google Ads export (GENERATED per account)
 *   Client:  __CLIENT_NAME__
 *   Account: __ACCOUNT_LABEL__ (__ACCOUNT_ID__)
 *
 * Paste into this account's Google Ads → Tools → Bulk actions → Scripts → New script,
 * replace PASTE_INGEST_TOKEN, click Authorize, Run once, then schedule it HOURLY.
 * Read-only on the ads account; the only external calls are to Deksia.
 * Each run posts recent days AND drains any queued backfill days automatically.
 */
var CLIENT_SLUG  = "__CLIENT_SLUG__";
// This script belongs to ONE account; it refuses to run anywhere else.
var EXPECT_CID   = "__ACCOUNT_ID__";
var INGEST_TOKEN = "PASTE_INGEST_TOKEN";

${body}

function main() {
  var acct = AdsApp.currentAccount();
  var cid = acct.getCustomerId();
  if (EXPECT_CID && EXPECT_CID.replace(/\\D/g, "") !== cid.replace(/\\D/g, "")) {
    throw new Error("Wrong account: this script is for " + EXPECT_CID + " but is installed in " + cid
      + ". Ask Deksia for this account's script.");
  }
  runAccount_(cid);
}
`;

const root = new URL("../../", import.meta.url);
writeFileSync(new URL("orchestrator/google-ads-mcc-script.js", root), MCC);
writeFileSync(new URL("orchestrator/google-ads-account-script.js", root), ACCOUNT);

// (The console script generator was retired 2026-09-15: Google Ads is pulled by API.)
