#!/usr/bin/env node
// Headless Composio probe via the official SDK (new tool-router platform).
// 1) validates COMPOSIO_API_KEY by listing connected accounts in its workspace
// 2) prints toolkit -> connected-account id (so we wire the right IDs into run.mjs)
// 3) executes one GA4 run_report if a google_analytics connection is found.
// Run:  node --env-file=orchestrator/.env orchestrator/probe.mjs
import { Composio } from "@composio/core";

if (!process.env.COMPOSIO_API_KEY) { console.error("COMPOSIO_API_KEY not set"); process.exit(1); }
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

let accounts;
try {
  const res = await composio.connectedAccounts.list({});
  accounts = res.items || res.data || res;
} catch (e) {
  console.error("AUTH/LIST FAILED:", e.message); process.exit(1);
}
const list = Array.isArray(accounts) ? accounts : (accounts.items || []);
console.log(`Connected accounts (${list.length}):`);
const byToolkit = {};
for (const a of list) {
  const tk = (a.toolkit?.slug || a.toolkit || a.appName || a.integration?.toolkit || "?").toString().toLowerCase();
  console.log(`  ${tk.padEnd(20)} id=${a.id}  status=${a.status}`);
  if (!byToolkit[tk] && (a.status === "ACTIVE" || a.status === "active")) byToolkit[tk] = a.id;
}

const ga = byToolkit["googleanalytics"] || byToolkit["google_analytics"];
if (!ga) { console.log("\nNo google_analytics connection found in this workspace."); process.exit(0); }
console.log(`\nExecuting GA4 run_report via ${ga} ...`);
try {
  const r = await composio.tools.execute("GOOGLE_ANALYTICS_RUN_REPORT", {
    connectedAccountId: ga,
    arguments: { property: "properties/308093077",
      dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }], metrics: [{ name: "sessions" }] },
  });
  const rows = r.data?.rows || r.data?.data?.rows || [];
  console.log("PROBE OK — successful:", r.successful, "| rows:", rows.length, "| sample:", JSON.stringify(rows[0] || {}).slice(0, 160));
} catch (e) { console.error("EXECUTE FAILED:", e.message); process.exit(1); }
