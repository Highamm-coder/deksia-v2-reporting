#!/usr/bin/env node
// Deksia platform orchestrator — scheduled runner.
// Per active client+source: pull yesterday's metrics, POST to the ingest-metrics
// edge function (idempotent), then trigger the in-DB SMART goal tracker.
//
// Date boundaries: America/New_York. Safe to re-run (ingest + tracker are idempotent).
//
// Env (GitHub Actions secrets):
//   SUPABASE_URL                e.g. https://ykxauddrsnuwkvimkdhw.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   read client_sources + call RPC
//   INGEST_TOKEN                bearer for ingest-metrics
//   CALLRAIL_API_KEY            CallRail v3 API key
//   COMPOSIO_API_KEY            (optional) for GA4/Meta pulls via Composio
//
// Coverage today: CallRail (REST, implemented). Google Ads arrives via the MCC
// Script POST (push, no pull needed here). GA4/Meta are pulled by the Claude
// `client-reporting` routine OR via the Composio extension point below.

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN,
  CALLRAIL_API_KEY, COMPOSIO_API_KEY,
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN })) {
  if (!v) { console.error(`Missing required env ${k}`); process.exit(1); }
}

// ---- yesterday in America/New_York (YYYY-MM-DD) ----
function etYesterday() {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() - 1);
  return et.toISOString().slice(0, 10);
}
const DAY = process.env.RUN_DATE || etYesterday();

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function ingest(source, clientSlug, rows) {
  if (!rows.length) return 0;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest-metrics`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source, client_slug: clientSlug, rows }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`ingest ${clientSlug}/${source}: ${JSON.stringify(out)}`);
  return out.rows_upserted ?? 0;
}

// ---- CallRail: count calls + form submissions for the day ----
async function pullCallRail(src) {
  if (!CALLRAIL_API_KEY) return [];
  const account = src.params?.account_id;
  const company = src.external_id;
  if (!account) { console.warn(`CallRail ${src.slug}: no account_id in params`); return []; }
  const base = `https://api.callrail.com/v3/a/${account}`;
  const q = `company_id=${company}&start_date=${DAY}&end_date=${DAY}&per_page=1`;
  const hdr = { Authorization: `Token token=${CALLRAIL_API_KEY}` };
  const [calls, forms] = await Promise.all([
    fetch(`${base}/calls.json?${q}`, { headers: hdr }).then(r => r.json()),
    fetch(`${base}/form_submissions.json?${q}`, { headers: hdr }).then(r => r.json()),
  ]);
  const rows = [];
  if (typeof calls.total_records === "number") rows.push({ metric_name: "calls", metric_date: DAY, value: calls.total_records, unit: "int", meta: { brand: src.params?.brand } });
  if (typeof forms.total_records === "number") rows.push({ metric_name: "forms", metric_date: DAY, value: forms.total_records, unit: "int", meta: { brand: src.params?.brand } });
  return rows;
}

// ---- Composio extension point for GA4 / Meta (optional) ----
// Implement against the Composio execute API once COMPOSIO_API_KEY + tool slugs
// are configured. Until then these sources are pulled by the Claude routine.
async function pullComposio(/* src */) {
  if (!COMPOSIO_API_KEY) return [];
  // TODO: call Composio GOOGLE_ANALYTICS_RUN_REPORT / ads_get_ad_entities per src,
  //       normalize to [{metric_name, metric_date, value, unit}], return rows.
  return [];
}

async function main() {
  console.log(`Orchestrator run for ${DAY} (America/New_York)`);
  const sources = await sb(
    "client_sources?select=source,external_id,params,clients!inner(slug,status)&active=eq.true&clients.status=eq.active"
  );
  const tally = {};
  for (const s of sources) {
    const src = { ...s, slug: s.clients.slug };
    let rows = [];
    try {
      if (src.source === "callrail") rows = await pullCallRail(src);
      else if (src.source === "ga4" || src.source === "meta") rows = await pullComposio(src);
      else continue; // google_ads = push via MCC Script
      const n = await ingest(src.source, src.slug, rows);
      tally[src.source] = (tally[src.source] || 0) + n;
    } catch (e) {
      console.error(`  ! ${src.slug}/${src.source}: ${e.message}`);
    }
  }
  console.log("Ingested:", JSON.stringify(tally));

  // trigger the SMART goal tracker (idempotent per as_of day)
  const tracked = await sb("rpc/run_goal_tracker", { method: "POST", body: JSON.stringify({}) });
  console.log("Tracker:", JSON.stringify(tracked));
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
