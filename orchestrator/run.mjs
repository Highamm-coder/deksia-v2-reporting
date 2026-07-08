#!/usr/bin/env node
// Deksia platform orchestrator — scheduled runner (hands-free daily).
// Per active client+source: pull the window's metrics, POST to ingest-metrics
// (idempotent), ingest the Google Ads Ledger sheet, then trigger the goal tracker.
//
// Date boundaries: America/New_York. Safe to re-run (ingest + tracker idempotent).
//
// Fully headless — every source goes direct to the vendor API. No Composio, no
// Claude session required. Runs on GitHub Actions cron (see .github/workflows and
// orchestrator/HEADLESS-SETUP.md for the credential checklist).
//
// Env (GitHub Actions secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN   (required)
//   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
//                           Google OAuth as the user that already has access to all
//                           GA4 properties + the Ledger sheet (no per-account grants).
//                           Powers the GA4 Data API pull; without them GA4 skips.
//                           Mint the refresh token once via orchestrator/get-refresh-token.mjs.
//   CALLRAIL_API_KEY        CallRail v3 REST (calls/forms)
//   META_ACCESS_TOKEN       Meta Graph API — long-lived system-user token (ad-account
//                           insights; + pages_read_engagement/read_insights for Pages)
//   RUN_START / RUN_END     optional YYYY-MM-DD window override (default = yesterday ET)

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN,
  CALLRAIL_API_KEY, META_ACCESS_TOKEN,
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN,
} = process.env;
const GOOGLE_READY = !!(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN);

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN })) {
  if (!v) { console.error(`Missing required env ${k}`); process.exit(1); }
}

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
  // tolerate empty bodies: 204 No Content, or a 200/201 with no JSON (e.g. a void RPC,
  // or an insert with Prefer: return=minimal). res.json() would throw on those.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function ingest(source, clientSlug, rows) {
  if (!rows.length) return 0;
  // chunk large payloads — fine-grain backfills can be 10k+ rows per client/source,
  // which blows the edge function's memory (WORKER_RESOURCE_LIMIT). Idempotent, so
  // chunking is safe.
  const CHUNK = 1500;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await fetchT(`${SUPABASE_URL}/functions/v1/ingest-metrics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source, client_slug: clientSlug, rows: rows.slice(i, i + CHUNK) }),
    }, 60000);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`ingest ${clientSlug}/${source}: ${JSON.stringify(out)}`);
    total += out.rows_upserted ?? 0;
  }
  return total;
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

// ---- Google OAuth (GA4 Data API) via refresh token, no deps ----
// Authenticates AS the user that already has access to every GA4 property + the
// Ledger sheet — so there are no per-account service-account grants to maintain.
let _googleToken = null; // { token, exp } — cached for the run

async function getGoogleToken() {
  if (_googleToken && _googleToken.exp > Date.now() / 1000 + 60) return _googleToken.token;
  if (!GOOGLE_READY) throw new Error("GOOGLE_OAUTH_* not set (client id/secret/refresh token)");
  const now = Math.floor(Date.now() / 1000);
  const res = await fetchT("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.access_token) throw new Error(`google token: ${res.status} ${JSON.stringify(out).slice(0, 200)}`);
  _googleToken = { token: out.access_token, exp: now + (out.expires_in || 3600) };
  return _googleToken.token;
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

// ---- GA4 (Data API v1beta, direct): daily x channel-group ----
const GA4_METRICS = [["sessions","sessions"],["users","totalUsers"],["new_users","newUsers"],
  ["engaged_sessions","engagedSessions"],["key_events","keyEvents"]];
async function pullGA4(src) {
  if (!GOOGLE_READY) return [];
  const token = await getGoogleToken();
  const res = await fetchT(`https://analyticsdata.googleapis.com/v1beta/properties/${src.external_id}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: START, endDate: END }],
      // finest useful grain the Data API reports without BigQuery export:
      // day × channel group × source/medium. Rows partition (don't overlap), so they
      // still sum exactly to GA4's own channel/property totals.
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }, { name: "sessionSourceMedium" }],
      metrics: GA4_METRICS.map(([, api]) => ({ name: api })),
      limit: 100000,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ga4 ${src.external_id}: ${res.status} ${JSON.stringify(data.error || data).slice(0, 200)}`);
  // Per-segment rows ONLY (qualifier="channel | source/medium"). Never also write an
  // unsegmented qualifier='' total — the tracker/rollup views sum across rows, so a
  // loose total would double-count.
  // NOTE: users/new_users are non-additive across segments — excluded from reporting
  // views (0009); the raw per-segment rows here are exactly what GA4 reports.
  const rows = [];
  for (const r of (data.rows || [])) {
    const day = ymd(r.dimensionValues[0].value);
    const channel = r.dimensionValues[1].value;
    const sourceMedium = r.dimensionValues[2].value;
    r.metricValues.forEach((mv, i) => {
      rows.push({ metric_name: GA4_METRICS[i][0], metric_date: day, value: Number(mv.value || 0), unit: "int",
                  account_ext_id: src.external_id, entity: src.params?.brand || "",
                  qualifier: `${channel} | ${sourceMedium}` });
    });
  }
  return rows;
}

// ---- Meta (Graph API): daily insights at the API's finest useful grain ----
// Counts at AD level (entity=campaign, qualifier="adset › ad") — the deepest grain
// the insights API reports; ad rows sum exactly to Meta's own account totals.
// Rates (ctr/cpc) at ACCOUNT level as Meta computes them — an averaged ad-level rate
// would be a number Meta never shows.
// account_ext_id is REQUIRED on every row: a client with 2+ Meta ad accounts would
// otherwise upsert both onto the same PK — last write wins.
async function metaInsights(acct, params) {
  let url = `${META_API}/act_${acct}/insights?time_increment=1`
          + `&time_range=${encodeURIComponent(JSON.stringify({ since: START, until: END }))}`
          + `&${params}&limit=500&access_token=${META_ACCESS_TOKEN}`;
  // Follow pagination — long windows/many ads span pages; page 1 alone truncates.
  const out = [];
  for (let page = 0; url && page < 50; page++) {
    const d = await fetchT(url).then(r => r.json());
    if (d.error) throw new Error(`meta ${acct}: ${d.error.message}`);
    out.push(...(d.data || []));
    url = d.paging?.next || null;
  }
  return out;
}

async function pullMeta(src) {
  if (!META_ACCESS_TOKEN) return [];                       // skip until token configured
  const rows = [];
  const push = (name, val, unit, extra = {}) => {
    if (val != null) rows.push({ metric_name: name, metric_date: extra.date, value: val, unit,
      account_ext_id: src.external_id, entity: extra.entity || "", qualifier: extra.qualifier || "" });
  };

  // 1) counts at ad level
  const ads = await metaInsights(src.external_id,
    "level=ad&fields=campaign_name,adset_name,ad_name,impressions,clicks,spend,actions");
  for (const r of ads) {
    const date = r.date_start;
    const entity = r.campaign_name || "";
    const qualifier = `${r.adset_name || ""} › ${r.ad_name || ""}`;
    const lead = (r.actions || []).find(a => a.action_type === "lead");
    const link = (r.actions || []).find(a => a.action_type === "link_click");
    push("impressions", toNumber(r.impressions), "int", { date, entity, qualifier });
    push("clicks",      toNumber(r.clicks), "int", { date, entity, qualifier });
    push("spend",       toNumber(r.spend), "usd", { date, entity, qualifier });
    push("leads",       lead ? Number(lead.value) : null, "int", { date, entity, qualifier });
    push("link_clicks", link ? Number(link.value) : null, "int", { date, entity, qualifier });
  }

  // 2) rates at account level, exactly as Meta computes them
  const acct = await metaInsights(src.external_id, "level=account&fields=ctr,cpc");
  for (const r of acct) {
    push("ctr", toNumber(r.ctr), "pct", { date: r.date_start });
    push("cpc", toNumber(r.cpc), "usd", { date: r.date_start });
  }
  return rows;
}

// ---- Pages (Graph API, direct): organic daily insights (best-effort) ----
// Needs a token with pages_read_engagement + read_insights and the page managed by
// the token owner. Only ~5/18 pages are currently accessible; failures skip quietly.
const PAGE_METRICS = { page_daily_follows_unique: "followers", page_media_view: "reach",
  page_post_engagements: "engagement", page_video_views: "video_views" };
async function pullPages(src) {
  if (!META_ACCESS_TOKEN) return [];
  try {
    // exchange the user/system token for this page's token
    const pt = await fetchT(`${META_API}/${src.external_id}?fields=access_token&access_token=${META_ACCESS_TOKEN}`)
      .then(r => r.json());
    const pageToken = pt.access_token;
    if (!pageToken) { console.warn(`Pages ${src.slug}: no page token (not managed / missing scope)`); return []; }
    const url = `${META_API}/${src.external_id}/insights?metric=${Object.keys(PAGE_METRICS).join(",")}`
      + `&period=day&since=${START}&until=${END}&access_token=${pageToken}`;
    const data = await fetchT(url).then(r => r.json());
    if (data.error) { console.warn(`Pages ${src.slug}: ${data.error.message}`); return []; }
    const rows = [];
    for (const m of (data.data || [])) {
      const name = PAGE_METRICS[m.name]; if (!name) continue;
      for (const v of (m.values || [])) {
        const date = (v.end_time || "").slice(0, 10); if (!date) continue;
        if (v.value != null && typeof v.value === "number")
          // account_ext_id=page id — same PK-collision guard as pullMeta for multi-page clients
          rows.push({ metric_name: name, metric_date: date, value: v.value, unit: "int", account_ext_id: src.external_id });
      }
    }
    return rows;
  } catch (e) { console.warn(`Pages ${src.slug}: ${e.message}`); return []; }
}

// Google Ads is PUSH-based: the Google Ads Scripts (MCC or per-account) POST straight
// to ingest-metrics, so there's nothing to pull here and no Ledger sheet to read/fill.
// See orchestrator/google-ads-mcc-script.js and google-ads-account-script.js.

async function main() {
  console.log(`Orchestrator run ${START}..${END} (America/New_York)`);
  const sources = await sb(
    "client_sources?select=source,external_id,params,active,clients!inner(slug,status)&active=eq.true&clients.status=eq.active"
  );
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
  // (google_ads arrives via the Google Ads Scripts POSTing directly — not pulled here)

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
