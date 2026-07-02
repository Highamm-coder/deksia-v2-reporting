#!/usr/bin/env node
// Deksia platform orchestrator — scheduled runner (hands-free daily).
// Per active client+source: pull the window's metrics, POST to ingest-metrics
// (idempotent), ingest the Google Ads Ledger sheet, then trigger the goal tracker.
//
// Date boundaries: America/New_York. Safe to re-run (ingest + tracker idempotent).
//
// Env (GitHub Actions secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN   (required)
//   CALLRAIL_API_KEY        CallRail v3 REST (calls/forms)
//   COMPOSIO_API_KEY        GA4 + Pages + Google Ads Ledger sheet (Composio hosted API)
//   META_ACCESS_TOKEN       Meta Graph API (ad-account insights); optional
//   RUN_START / RUN_END     optional YYYY-MM-DD window override (default = yesterday ET)
//   *_CONNECTED_ACCOUNT_ID  optional Composio connected-account overrides
//
// Composio hosted execute API: POST /api/v3/tools/execute/{slug}, header x-api-key,
// body { connected_account_id, arguments }.  (docs.composio.dev/api-reference)

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN,
  CALLRAIL_API_KEY, COMPOSIO_API_KEY, META_ACCESS_TOKEN,
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN })) {
  if (!v) { console.error(`Missing required env ${k}`); process.exit(1); }
}

// Composio connected-account IDs (this workspace; override via env).
const CA = {
  ga4:      process.env.GA4_CONNECTED_ACCOUNT_ID      || "google_analytics_duhat-aspace",
  sheets:   process.env.SHEETS_CONNECTED_ACCOUNT_ID   || "googlesheets_divot-reroll",
  facebook: process.env.FACEBOOK_CONNECTED_ACCOUNT_ID || "",
};
const GA_LEDGER_SHEET = "1cEIfUfd_AFd4r82qt9p9imuo7oaqcJqwgZXAGXRSzhU";
const META_API = "https://graph.facebook.com/v21.0";

function etDate(offsetDays = 0) {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() + offsetDays);
  return et.toISOString().slice(0, 10);
}
const START = process.env.RUN_START || process.env.RUN_DATE || etDate(-1);
const END   = process.env.RUN_END   || process.env.RUN_DATE || etDate(-1);

// ---- helpers ----
// fetch with a 30s timeout — fail fast instead of hanging a scheduled run
async function fetchT(url, opts = {}, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error(`timeout after ${ms}ms`)), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

// bounded-concurrency map (don't hammer APIs; don't run serially either)
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function sb(path, opts = {}) {
  const res = await fetchT(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function ingest(source, clientSlug, rows) {
  if (!rows.length) return 0;
  const res = await fetchT(`${SUPABASE_URL}/functions/v1/ingest-metrics`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source, client_slug: clientSlug, rows }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`ingest ${clientSlug}/${source}: ${JSON.stringify(out)}`);
  return out.rows_upserted ?? 0;
}

// Meta display strings -> number ("$7,852.95 USD", "1.71%", "" / "Not available" -> null)
function toNumber(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/ /g, " ").trim();
  if (t === "" || /not available/i.test(t)) return null;
  const n = parseFloat(t.replace(/[$,%]/g, "").replace(/USD/i, "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
const ymd = (yyyymmdd) => `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;

async function composioExec(toolSlug, connectedAccountId, args) {
  if (!COMPOSIO_API_KEY) throw new Error("COMPOSIO_API_KEY not set");
  const res = await fetchT(`https://backend.composio.dev/api/v3/tools/execute/${toolSlug}`, {
    method: "POST",
    headers: { "x-api-key": COMPOSIO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ connected_account_id: connectedAccountId, arguments: args }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.successful === false || out.error)
    throw new Error(`composio ${toolSlug}: ${res.status} ${JSON.stringify(out.error || out).slice(0,300)}`);
  return out.data ?? out;
}

// ---- CallRail: calls + forms per day, split by source (qualifier) + loose total ----
async function pullCallRail(src) {
  if (!CALLRAIL_API_KEY) return [];
  const account = src.params?.account_id, company = src.external_id;
  if (!account) { console.warn(`CallRail ${src.slug}: no account_id`); return []; }
  const hdr = { Authorization: `Token token=${CALLRAIL_API_KEY}` };
  const base = `https://api.callrail.com/v3/a/${account}`;
  const fetchAll = async (endpoint, dateField) => {
    const byKey = {}; // `${date}|${source}` -> count
    const HARD_CAP = 200; // sanity cap (~50k records/day/company); warn if hit
    for (let page = 1; ; page++) {
      const q = `company_id=${company}&start_date=${START}&end_date=${END}&per_page=250&page=${page}&fields=${dateField},source`;
      const d = await fetchT(`${base}/${endpoint}.json?${q}`, { headers: hdr }).then(r => r.json());
      const recs = d[endpoint === "calls" ? "calls" : "form_submissions"] || [];
      for (const r of recs) {
        const day = (r[dateField] || "").slice(0, 10); if (!day) continue;
        const s = r.source || "Unknown";
        byKey[`${day}|${s}`] = (byKey[`${day}|${s}`] || 0) + 1;
      }
      const totalPages = d.total_pages || 1;
      if (page >= totalPages || !recs.length) break;
      if (page >= HARD_CAP) { console.warn(`! CallRail ${endpoint} ${company}: TRUNCATED at ${HARD_CAP}/${totalPages} pages`); break; }
    }
    return byKey;
  };
  const calls = await fetchAll("calls", "start_time");
  const forms = await fetchAll("form_submissions", "submitted_at");
  // Per-source rows ONLY (qualifier=source); no loose qualifier='' total (would double-count
  // in the tracker). account_ext_id=company so a client's multiple CallRail companies
  // (e.g. Hatton Wake + Nebar) stay distinct on the PK instead of overwriting each other.
  const rows = [];
  for (const k of new Set([...Object.keys(calls), ...Object.keys(forms)])) {
    const [day, source] = k.split("|");
    const c = calls[k] || 0, f = forms[k] || 0;
    if (c) rows.push({ metric_name: "calls", metric_date: day, value: c, unit: "int", account_ext_id: company, qualifier: source });
    if (f) rows.push({ metric_name: "forms", metric_date: day, value: f, unit: "int", account_ext_id: company, qualifier: source });
    rows.push({ metric_name: "mqls", metric_date: day, value: c + f, unit: "int", account_ext_id: company, qualifier: source });
  }
  return rows;
}

// ---- GA4 (Composio): daily x channel-group, plus unsegmented daily totals ----
const GA4_METRICS = [["sessions","sessions"],["users","totalUsers"],["new_users","newUsers"],
  ["engaged_sessions","engagedSessions"],["key_events","keyEvents"]];
async function pullGA4(src) {
  const data = await composioExec("GOOGLE_ANALYTICS_RUN_REPORT", CA.ga4, {
    property: `properties/${src.external_id}`,
    dateRanges: [{ startDate: START, endDate: END }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: GA4_METRICS.map(([, api]) => ({ name: api })),
    limit: 100000,
  });
  // Per-segment rows ONLY (qualifier=channel). Do NOT also write an unsegmented
  // qualifier='' total — the tracker/rollup views sum across rows, so a loose total
  // would double-count. Channel sums are correct for sessions/engaged_sessions/key_events.
  // NOTE: users/new_users summed across channels slightly overcount unique users; no active
  // goal uses them today — add a dedicated unsegmented total if such a goal is created.
  const rows = [];
  for (const r of (data.rows || [])) {
    const day = ymd(r.dimensionValues[0].value);
    const channel = r.dimensionValues[1].value;
    r.metricValues.forEach((mv, i) => {
      rows.push({ metric_name: GA4_METRICS[i][0], metric_date: day, value: Number(mv.value || 0), unit: "int",
                  account_ext_id: src.external_id, entity: src.params?.brand || "", qualifier: channel });
    });
  }
  return rows;
}

// ---- Meta (Graph API): daily ad-account insights ----
async function pullMeta(src) {
  if (!META_ACCESS_TOKEN) return [];                       // skip until token configured
  const fields = "impressions,clicks,ctr,cpc,spend,actions";
  const url = `${META_API}/act_${src.external_id}/insights?level=account&time_increment=1`
            + `&time_range=${encodeURIComponent(JSON.stringify({ since: START, until: END }))}`
            + `&fields=${fields}&access_token=${META_ACCESS_TOKEN}`;
  const d = await fetchT(url).then(r => r.json());
  if (d.error) throw new Error(`meta ${src.external_id}: ${d.error.message}`);
  const rows = [];
  for (const day of (d.data || [])) {
    const date = day.date_start;
    const lead = (day.actions || []).find(a => a.action_type === "lead");
    const link = (day.actions || []).find(a => a.action_type === "link_click");
    const push = (name, val, unit) => { if (val != null) rows.push({ metric_name: name, metric_date: date, value: val, unit }); };
    push("impressions", toNumber(day.impressions), "int");
    push("clicks",      toNumber(day.clicks), "int");
    push("ctr",         toNumber(day.ctr), "pct");
    push("cpc",         toNumber(day.cpc), "usd");
    push("spend",       toNumber(day.spend), "usd");
    push("leads",       lead ? Number(lead.value) : null, "int");
    push("link_clicks", link ? Number(link.value) : null, "int");
  }
  return rows;
}

// ---- Pages (Composio Facebook): organic daily insights ----
const PAGE_METRICS = { page_daily_follows_unique: "followers", page_media_view: "reach",
  page_post_engagements: "engagement", page_video_views: "video_views" };
async function pullPages(src) {
  if (!CA.facebook) return [];                              // skip until FB connection configured
  const data = await composioExec("FACEBOOK_GET_PAGE_INSIGHTS", CA.facebook, {
    page_id: src.external_id, period: "day", since: START, until: END,
    metrics: Object.keys(PAGE_METRICS).join(","),
  }).catch(e => { console.warn(`Pages ${src.slug}: ${e.message}`); return null; });
  const series = data?.data || data?.insights || [];       // shape validated at probe
  const rows = [];
  for (const m of series) {
    const name = PAGE_METRICS[m.name]; if (!name) continue;
    for (const v of (m.values || [])) {
      const date = (v.end_time || "").slice(0, 10); if (!date) continue;
      if (v.value != null && typeof v.value === "number")
        rows.push({ metric_name: name, metric_date: date, value: v.value, unit: "int" });
    }
  }
  return rows;
}

// ---- Google Ads Ledger sheet -> metrics_daily (campaign + conversion_action) ----
async function pullGoogleAdsSheet(cidToSlug) {
  if (!COMPOSIO_API_KEY) return {};
  const res = await composioExec("GOOGLESHEETS_BATCH_GET", CA.sheets, {
    spreadsheet_id: GA_LEDGER_SHEET, ranges: ["Campaigns!A2:H100000", "Conversions!A2:F100000"],
  });
  const vr = res.valueRanges || res.response?.data?.valueRanges || [];
  const camp = (vr[0]?.values) || [], conv = (vr[1]?.values) || [];
  const digits = s => String(s || "").replace(/[^0-9]/g, "");
  const inWindow = d => d >= START && d <= END;
  // dedup latest by key (sheet appends; last write wins)
  const campRows = {}, convRows = {};
  for (const r of camp) { const [date,cid,acct,campaign,imp,clk,cost,convs] = r;
    if (!date || !inWindow(date) || !cidToSlug[digits(cid)]) continue;
    campRows[`${cid}|${campaign}|${date}`] = { date, cid, campaign, imp, clk, cost, convs }; }
  for (const r of conv) { const [date,cid,acct,campaign,action,convs] = r;
    if (!date || !inWindow(date) || !cidToSlug[digits(cid)]) continue;
    convRows[`${cid}|${campaign}|${action}|${date}`] = { date, cid, campaign, action, convs }; }
  const bySlug = {}; // slug -> rows
  const add = (slug, row) => { (bySlug[slug] = bySlug[slug] || []).push(row); };
  for (const v of Object.values(campRows)) { const slug = cidToSlug[digits(v.cid)];
    const base = { metric_date: v.date, account_ext_id: digits(v.cid), entity: v.campaign || "" };
    add(slug, { ...base, metric_name: "impressions", value: toNumber(v.imp), unit: "int" });
    add(slug, { ...base, metric_name: "clicks",      value: toNumber(v.clk), unit: "int" });
    add(slug, { ...base, metric_name: "spend",       value: toNumber(v.cost), unit: "usd" });
    add(slug, { ...base, metric_name: "conversions", value: toNumber(v.convs), unit: "int" }); }
  for (const v of Object.values(convRows)) { const slug = cidToSlug[digits(v.cid)];
    add(slug, { metric_date: v.date, account_ext_id: digits(v.cid), entity: v.campaign || "",
                qualifier: v.action || "", metric_name: "conversion_action", value: toNumber(v.convs), unit: "int" }); }
  const tally = {};
  for (const [slug, rows] of Object.entries(bySlug)) tally[slug] = await ingest("google_ads", slug, rows.filter(r => r.value != null));
  return tally;
}

async function main() {
  console.log(`Orchestrator run ${START}..${END} (America/New_York)`);
  const sources = await sb(
    "client_sources?select=source,external_id,params,active,clients!inner(slug,status)&active=eq.true&clients.status=eq.active"
  );
  const cidToSlug = {};
  for (const s of sources) if (s.source === "google_ads")
    cidToSlug[String(s.external_id).replace(/[^0-9]/g, "")] = s.clients.slug;

  const PULLERS = { callrail: pullCallRail, ga4: pullGA4, meta: pullMeta, pages: pullPages };
  const tally = {}, health = {}; // health[source] = {ok, fail}
  const mark = (source, ok) => { const h = health[source] = health[source] || { ok: 0, fail: 0 }; ok ? h.ok++ : h.fail++; };

  // bounded parallelism: 5 concurrent pulls (google_ads comes from the Ledger sheet below)
  await mapLimit(sources.filter(s => PULLERS[s.source]), 5, async (s) => {
    const src = { ...s, slug: s.clients.slug };
    try {
      const rows = await PULLERS[src.source](src);
      const n = await ingest(src.source, src.slug, rows.filter(r => r.value != null));
      tally[src.source] = (tally[src.source] || 0) + n;
      mark(src.source, true);
    } catch (e) { console.error(`  ! ${src.slug}/${src.source}: ${e.message}`); mark(src.source, false); }
  });
  try { const g = await pullGoogleAdsSheet(cidToSlug);
    tally.google_ads = Object.values(g).reduce((a, b) => a + b, 0);
    mark("google_ads", true);
  } catch (e) { console.error(`  ! google_ads sheet: ${e.message}`); mark("google_ads", false); }

  console.log("Ingested rows:", JSON.stringify(tally));
  console.log("Source health:", JSON.stringify(health));
  // a source where EVERY pull failed = red run (surface it, don't exit green)
  const deadSources = Object.entries(health).filter(([, h]) => h.fail > 0 && h.ok === 0).map(([k]) => k);
  if (deadSources.length) process.exitCode = 1;
  const tracked = await sb("rpc/run_goal_tracker", { method: "POST", body: JSON.stringify({}) });
  await sb("run_log", { method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ period: START === END ? START : `${START}..${END}`,
      clients_processed: new Set(sources.map(s => s.clients.slug)).size,
      rows_written: Object.values(tally).reduce((a, b) => a + b, 0),
      sources: Object.keys(tally),
      notes: `orchestrator; tracker ${JSON.stringify(tracked?.[0] || tracked)}`
        + (deadSources.length ? `; FAILED sources: ${deadSources.join(",")}` : "") }) });
  console.log("Tracker:", JSON.stringify(tracked), deadSources.length ? `\nFAILED sources: ${deadSources.join(",")}` : "", "\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
