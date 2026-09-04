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
//   ONLY_SLUG               optional client slug — pull that client only
//   ONLY_SOURCE             optional source name — pull that source only
//   WRITE_BREAKOUTS=1       force Meta brk: breakouts even outside the 90-day horizon

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN,
  CALLRAIL_API_KEY, META_ACCESS_TOKEN,
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN,
  GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID,
} = process.env;
const GOOGLE_READY = !!(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN);
// Google Ads API (direct pull) needs the OAuth trio + a developer token + the MCC id.
const GADS_READY = GOOGLE_READY && !!(GOOGLE_ADS_DEVELOPER_TOKEN && GOOGLE_ADS_LOGIN_CUSTOMER_ID);

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INGEST_TOKEN })) {
  if (!v) { console.error(`Missing required env ${k}`); process.exit(1); }
}

const META_API = "https://graph.facebook.com/v21.0";

function etDate(offsetDays = 0) {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() + offsetDays);
  return et.toISOString().slice(0, 10);
}
let START = process.env.RUN_START || process.env.RUN_DATE || etDate(-1);
let END   = process.env.RUN_END   || process.env.RUN_DATE || etDate(-1);

// Re-pull one client only. Used when a client's metric depth changes: the new
// metrics only exist for days that get pulled again, and re-running every client
// to fill in one account's history is a lot of API calls for nothing.
const ONLY_SLUG = (process.env.ONLY_SLUG || "").trim();
// Pull one source only (e.g. a Google Ads backfill month without re-pulling Meta/GA4).
const ONLY_SOURCE = (process.env.ONLY_SOURCE || "").trim();

// Meta 'brk:' breakouts (placement / demo / device) are non-additive drill-down that
// prune_metrics() deletes past BRK_RETENTION_DAYS. Writing them for a window that is
// already older than the horizon costs 3 extra Graph calls per account and produces
// rows the nightly prune removes the same day — so skip them. Set
// WRITE_BREAKOUTS=1 to force them on regardless.
const BRK_RETENTION_DAYS = 90;
let WRITE_BREAKOUTS = process.env.WRITE_BREAKOUTS === "1" || END >= etDate(-BRK_RETENTION_DAYS);
// backfill mode moves the window per chunk, so this is recomputed then
const recomputeBreakouts = () => { WRITE_BREAKOUTS = process.env.WRITE_BREAKOUTS === "1" || END >= etDate(-BRK_RETENTION_DAYS); };

// BACKFILL_MODE=1: instead of pulling a fixed window, claim chunks from backfill_jobs
// (queued from the console) and pull each one. Up to MAX_CHUNKS per invocation; a source
// that answers 429 "Retry in N seconds" is deferred for N seconds and the run moves on.
const BACKFILL_MODE = process.env.BACKFILL_MODE === "1";
const MAX_CHUNKS = Number(process.env.MAX_CHUNKS || 3);

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
  // Dedupe on the destination primary key before posting. Platforms can legitimately
  // return the same tuple twice in one response (e.g. Meta repeating an action_type
  // across attribution entries); Postgres rejects the whole batch with "cannot affect
  // row a second time" if we pass both. Last value wins — same as a re-run would.
  const byKey = new Map();
  for (const r of rows) {
    byKey.set(`${r.metric_name}|${r.metric_date}|${r.account_ext_id ?? ""}|${r.entity ?? ""}|${r.qualifier ?? ""}`, r);
  }
  if (byKey.size !== rows.length) rows = [...byKey.values()];
  // chunk large payloads — fine-grain backfills can be 10k+ rows per client/source,
  // which blows the edge function's memory (WORKER_RESOURCE_LIMIT). Idempotent, so
  // chunking is safe.
  const CHUNK = 1500;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const body = JSON.stringify({ source, client_slug: clientSlug,
      writer: "github-actions/run.mjs", rows: rows.slice(i, i + CHUNK) });
    // Retry transient server-side failures. Long backfills reliably meet them
    // (a Vault/token lookup or upsert timing out under concurrent load returns 5xx),
    // and losing a whole month's chunk to one blip is not acceptable.
    let out, lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetchT(`${SUPABASE_URL}/functions/v1/ingest-metrics`, {
          method: "POST",
          headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json" },
          body,
        }, 60000);
        out = await res.json().catch(() => ({}));
        if (res.ok) { lastErr = null; break; }
        lastErr = new Error(`ingest ${clientSlug}/${source}: ${res.status} ${JSON.stringify(out)}`);
        if (res.status < 500) break;                    // 4xx is our bug — don't retry
      } catch (e) { lastErr = e; }
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
    }
    if (lastErr) throw lastErr;
    total += out?.rows_upserted ?? 0;
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

// ---- Google Ads API: one GAQL query against one customer, all pages ----
// Versions sunset roughly a year after release, so try newest-first and remember the
// one that answers; a 404 on the version path is the only thing that moves us on.
const GADS_VERSIONS = (process.env.GOOGLE_ADS_API_VERSION || "v23,v22,v21,v20").split(",");
let _gadsVersion = null;
// MCC accounts are read with the MCC as login-customer-id. An account that granted the
// token's user access DIRECTLY (outside the MCC) rejects that with a 403 and can only be
// read with itself as the login customer. That retry is opt-in per call (`selfLogin`):
// the probe uses it to find out which outside accounts are reachable; the daily pull does
// NOT, so nothing is pulled from an outside-MCC account until that is switched on.
async function gadsQuery(cid, gaql, { selfLogin = false } = {}) {
  const tok = await getGoogleToken();
  const id = String(cid).replace(/\D/g, "");
  const mcc = String(GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, "");
  const logins = selfLogin ? [mcc, id] : [mcc];
  const versions = _gadsVersion ? [_gadsVersion] : GADS_VERSIONS;
  let lastErr = null;
  for (const login of logins) {
    for (const v of versions) {
      const r = await fetchT(`https://googleads.googleapis.com/${v}/customers/${id}/googleAds:searchStream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok}`, "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
          "login-customer-id": login, "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gaql }),
      }, 60000);
      const text = await r.text();
      if (r.status === 404 && !_gadsVersion) { lastErr = `${v} not served`; continue; }   // try an older version
      let body; try { body = JSON.parse(text); } catch { body = text; }
      if (!r.ok) {
        const err = Array.isArray(body) ? body[0]?.error : body?.error;
        const detail = err?.details?.[0]?.errors?.[0]?.message || err?.message || String(text).slice(0, 200);
        if (r.status === 403 && /permission to access customer/i.test(detail) && login !== id && logins.length > 1) { lastErr = detail; break; }
        throw new Error(`google ads ${id}: ${r.status} ${detail}${login === id ? " (as own login customer)" : ""}`);
      }
      _gadsVersion = v;
      const chunks = Array.isArray(body) ? body : [body];   // searchStream: array of chunks with .results
      const results = chunks.flatMap((c) => c.results || []);
      results.viaLogin = login === mcc ? "mcc" : "direct";
      return results;
    }
  }
  throw new Error(`google ads ${id}: 403 ${lastErr || "no API version answered"}`);
}

// ---- CallRail: calls + forms per day, split by source (qualifier) + loose total ----
async function pullCallRail(src) {
  if (!CALLRAIL_API_KEY) return [];
  const account = src.params?.account_id, company = src.external_id;
  if (!account) { console.warn(`CallRail ${src.slug}: no account_id`); return []; }
  const hdr = { Authorization: `Token token=${CALLRAIL_API_KEY}` };
  const base = `https://api.callrail.com/v3/a/${account}`;
  // returns `${date}|${source}` -> { n: total, q: qualified (CallRail lead_status='good_lead') }
  const fetchAll = async (endpoint, dateField) => {
    const byKey = {};
    const HARD_CAP = 200; // sanity cap (~50k records/day/company); warn if hit
    for (let page = 1; ; page++) {
      const q = `company_id=${company}&start_date=${START}&end_date=${END}&per_page=250&page=${page}&fields=${dateField},source,lead_status`;
      const r0 = await fetchT(`${base}/${endpoint}.json?${q}`, { headers: hdr });
      const d = await r0.json().catch(() => ({}));
      if (!r0.ok || d.error) throw new Error(`callrail ${endpoint} ${company}: ${r0.status} ${JSON.stringify(d.error || d).slice(0, 150)}`);
      const recs = d[endpoint === "calls" ? "calls" : "form_submissions"] || [];
      for (const r of recs) {
        const day = (r[dateField] || "").slice(0, 10); if (!day) continue;
        const s = r.source || "Unknown";
        const cell = byKey[`${day}|${s}`] || (byKey[`${day}|${s}`] = { n: 0, q: 0 });
        cell.n += 1;
        if (r.lead_status === "good_lead") cell.q += 1; // CallRail's own qualification
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
  const zero = { n: 0, q: 0 };
  for (const k of new Set([...Object.keys(calls), ...Object.keys(forms)])) {
    const [day, source] = k.split("|");
    const c = calls[k] || zero, f = forms[k] || zero;
    const base_ = { metric_date: day, unit: "int", account_ext_id: company, qualifier: source };
    if (c.n) rows.push({ ...base_, metric_name: "calls", value: c.n });
    if (f.n) rows.push({ ...base_, metric_name: "forms", value: f.n });
    rows.push({ ...base_, metric_name: "mqls", value: c.n + f.n });
    rows.push({ ...base_, metric_name: "qualified_leads", value: c.q + f.q });
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

// Meta reports ~90 action types per account, and most of them are either vanity
// engagement or a straight alias of another one — measured live 2026-08-28,
// omni_landing_page_view == landing_page_view to the unit (445,677 both), and
// page_engagement and post_engagement differ by 0.05%. Storing all of them gave one
// client 162 metric names and was a third of the table.
//
// STANDARD depth keeps the conversions an account is actually judged on, one row per
// real event. FULL depth keeps everything Meta returns, including its aliases and the
// unnamed offsite_conversion.custom.<pixel-id> events — set per client, per source, in
// client_sources.params.metric_depth (console: client → Settings → Meta metric depth).
// 'lead' is never filtered: it becomes `leads`, a priority metric.
const META_STANDARD_ACTIONS = new Set([
  "lead",                                             // → leads
  "onsite_conversion.lead_grouped",                   // Meta lead-form submissions
  "offsite_conversion.fb_pixel_lead",                 // pixel-fired leads
  "landing_page_view",
  "purchase", "add_to_cart", "initiate_checkout", "add_payment_info",
  "complete_registration", "subscribe", "start_trial", "donate",
  "contact", "schedule", "submit_application", "find_location",
  "click_to_call_call_confirm",                       // call button confirmed
  "onsite_conversion.messaging_conversation_started_7d",
  "post_engagement",                                  // the one engagement number
]);

// 'full' pulls every action type; anything else (including unset) is 'standard'.
const metaDepth = (src) => (src.params?.metric_depth === "full" ? "full" : "standard");
const keepAction = (depth, t) => depth === "full" || META_STANDARD_ACTIONS.has(t);

async function pullMeta(src) {
  if (!META_ACCESS_TOKEN) return [];                       // skip until token configured
  const rows = [];
  const depth = metaDepth(src);
  const push = (name, val, unit, extra = {}) => {
    if (val != null) rows.push({ metric_name: name, metric_date: extra.date, value: val, unit,
      account_ext_id: src.external_id, entity: extra.entity || "", qualifier: extra.qualifier || "" });
  };

  // 1) counts at ad level
  const ads = await metaInsights(src.external_id,
    "level=ad&fields=campaign_name,adset_name,ad_name,ad_id,impressions,clicks,spend,"
    + "inline_link_clicks,actions,action_values,"
    + "video_play_actions,video_thruplay_watched_actions,video_avg_time_watched_actions,"
    + "video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,"
    + "video_p95_watched_actions,video_p100_watched_actions");
  const seen = new Set(); // distinct ads can share a display name — disambiguate with Meta's ad_id
  for (const r of ads) {
    const date = r.date_start;
    const entity = r.campaign_name || "";
    let qualifier = `${r.adset_name || ""} › ${r.ad_name || ""}`;
    const key = `${date}|${entity}|${qualifier}`;
    if (seen.has(key)) qualifier += ` [${r.ad_id}]`;
    seen.add(key);
    push("impressions", toNumber(r.impressions), "int", { date, entity, qualifier });
    push("clicks",      toNumber(r.clicks), "int", { date, entity, qualifier });
    push("spend",       toNumber(r.spend), "usd", { date, entity, qualifier });
    push("link_clicks", toNumber(r.inline_link_clicks), "int", { date, entity, qualifier });

    // EVERY action type Meta reports for this ad, under its own metric name (the
    // Meta equivalent of Google's conversion actions). 'lead' keeps its historical
    // name so existing goals/formulas are unaffected.
    for (const a of (r.actions || [])) {
      const t = String(a.action_type || "");
      if (!t || t === "link_click") continue;              // link_click covered above
      if (!keepAction(depth, t)) continue;
      const metric = t === "lead" ? "leads" : `act_${t}`;
      push(metric, Number(a.value), "int", { date, entity, qualifier });
    }
    // and the value (revenue) Meta attributes to each action type, where the pixel sends it
    for (const a of (r.action_values || [])) {
      const t = String(a.action_type || "");
      if (!t || !keepAction(depth, t)) continue;
      push(`actval_${t}`, Number(a.value), "usd", { date, entity, qualifier });
    }
    // video engagement — the first element of each *_actions array is the total
    const v1 = (arr) => (Array.isArray(arr) && arr.length ? Number(arr[0].value) : null);
    push("video_plays",     v1(r.video_play_actions), "int", { date, entity, qualifier });
    push("thruplays",       v1(r.video_thruplay_watched_actions), "int", { date, entity, qualifier });
    push("video_avg_watch", v1(r.video_avg_time_watched_actions), "sec", { date, entity, qualifier });
    push("video_p25",  v1(r.video_p25_watched_actions), "int", { date, entity, qualifier });
    push("video_p50",  v1(r.video_p50_watched_actions), "int", { date, entity, qualifier });
    push("video_p75",  v1(r.video_p75_watched_actions), "int", { date, entity, qualifier });
    push("video_p95",  v1(r.video_p95_watched_actions), "int", { date, entity, qualifier });
    push("video_p100", v1(r.video_p100_watched_actions), "int", { date, entity, qualifier });
  }

  // 2) account-level metrics Meta reports as de-duplicated / computed totals — these are
  // NOT summable across ads (reach counts unique people; ctr/cpc/cpl are ratios), so they
  // live at account grain (entity='', qualifier='') exactly as Meta reports them per day.
  const acct = await metaInsights(src.external_id,
    "level=account&fields=ctr,cpc,cpm,cpp,reach,frequency,unique_ctr,"
    + "inline_link_click_ctr,cost_per_inline_link_click,cost_per_unique_click,"
    + "outbound_clicks,outbound_clicks_ctr,unique_clicks,cost_per_action_type");
  for (const r of acct) {
    push("ctr",   toNumber(r.ctr), "pct", { date: r.date_start });
    push("cpc",   toNumber(r.cpc), "usd", { date: r.date_start });
    push("cpm",   toNumber(r.cpm), "usd", { date: r.date_start });
    push("cpp",   toNumber(r.cpp), "usd", { date: r.date_start });
    push("reach", toNumber(r.reach), "int", { date: r.date_start });
    push("frequency", toNumber(r.frequency), "ratio", { date: r.date_start });
    push("unique_ctr", toNumber(r.unique_ctr), "pct", { date: r.date_start });
    push("link_ctr", toNumber(r.inline_link_click_ctr), "pct", { date: r.date_start });
    push("cost_per_link_click", toNumber(r.cost_per_inline_link_click), "usd", { date: r.date_start });
    push("cost_per_unique_click", toNumber(r.cost_per_unique_click), "usd", { date: r.date_start });
    push("unique_clicks", toNumber(r.unique_clicks), "int", { date: r.date_start });
    const ob = Array.isArray(r.outbound_clicks) && r.outbound_clicks.length ? Number(r.outbound_clicks[0].value) : null;
    push("outbound_clicks", ob, "int", { date: r.date_start });
    const obc = Array.isArray(r.outbound_clicks_ctr) && r.outbound_clicks_ctr.length ? Number(r.outbound_clicks_ctr[0].value) : null;
    push("outbound_ctr", obc, "pct", { date: r.date_start });
    // Meta's own cost per action, for EVERY action type it reports (lead keeps its name)
    for (const a of (r.cost_per_action_type || [])) {
      const t = String(a.action_type || "");
      if (!t || !keepAction(depth, t)) continue;
      push(t === "lead" ? "cost_per_lead" : `cpa_${t}`, Number(a.value), "usd", { date: r.date_start });
    }
  }

  // 3) CAMPAIGN-level rates, exactly as Meta computes them at that grain (not derived
  // from our ad rows). Stored with qualifier='rate' so they are a distinct grain:
  // the metric tables exclude them (they'd pollute the account-level averages) while
  // the campaign table shows them per campaign line.
  const camp = await metaInsights(src.external_id,
    "level=campaign&fields=campaign_name,ctr,cpc,cpm,cpp,frequency,reach,unique_ctr,"
    + "inline_link_click_ctr,cost_per_inline_link_click,outbound_clicks_ctr,"
    + "video_thruplay_watched_actions,purchase_roas,cost_per_action_type");
  for (const r of camp) {
    const name = r.campaign_name;
    if (!name) continue;
    const put = (metric, value, unit) => rows.push({
      metric_name: metric, metric_date: r.date_start, value, unit,
      account_ext_id: src.external_id, entity: name, qualifier: "rate",
    });
    put("ctr", toNumber(r.ctr), "pct");
    put("cpc", toNumber(r.cpc), "usd");
    put("cpm", toNumber(r.cpm), "usd");
    put("frequency", toNumber(r.frequency), "ratio");
    put("reach", toNumber(r.reach), "int");
    put("cpp", toNumber(r.cpp), "usd");
    put("unique_ctr", toNumber(r.unique_ctr), "pct");
    put("link_ctr", toNumber(r.inline_link_click_ctr), "pct");
    put("cost_per_link_click", toNumber(r.cost_per_inline_link_click), "usd");
    const cob = Array.isArray(r.outbound_clicks_ctr) && r.outbound_clicks_ctr.length
      ? Number(r.outbound_clicks_ctr[0].value) : null;
    put("outbound_ctr", cob, "pct");
    const roas = Array.isArray(r.purchase_roas) && r.purchase_roas.length ? Number(r.purchase_roas[0].value) : null;
    put("purchase_roas", roas, "ratio");
    const tp = Array.isArray(r.video_thruplay_watched_actions) && r.video_thruplay_watched_actions.length
      ? Number(r.video_thruplay_watched_actions[0].value) : null;
    put("thruplays", tp, "int");
    for (const a of (r.cost_per_action_type || [])) {
      const t = String(a.action_type || "");
      if (!t || !keepAction(depth, t)) continue;
      put(t === "lead" ? "cost_per_lead" : `cpa_${t}`, Number(a.value), "usd");
    }
  }

  // 4) PLACEMENT breakdown (Facebook vs Instagram vs Reels …) — a non-additive
  // breakout grain (qualifier 'brk:...') the views exclude from totals.
  if (WRITE_BREAKOUTS) try {
    const plat = await metaInsights(src.external_id,
      "level=campaign&breakdowns=publisher_platform,platform_position"
      + "&fields=campaign_name,impressions,clicks,spend");
    for (const r of plat) {
      if (!r.campaign_name) continue;
      const q = `brk:${r.publisher_platform || "unknown"}${r.platform_position ? " / " + r.platform_position : ""}`;
      push("impressions", toNumber(r.impressions), "int", { date: r.date_start, entity: r.campaign_name, qualifier: q });
      push("clicks", toNumber(r.clicks), "int", { date: r.date_start, entity: r.campaign_name, qualifier: q });
      push("spend", toNumber(r.spend), "usd", { date: r.date_start, entity: r.campaign_name, qualifier: q });
    }
  } catch (e) { console.warn(`Meta placements ${src.slug}: ${e.message}`); }

  // 4b) DEMOGRAPHIC + DEVICE breakouts (same non-additive 'brk:' grain)
  for (const [dims, tag] of (WRITE_BREAKOUTS ? [["age,gender", "demo"], ["impression_device", "device"]] : [])) {
    try {
      const rs = await metaInsights(src.external_id,
        `level=campaign&breakdowns=${dims}&fields=campaign_name,impressions,clicks,spend`);
      for (const r of rs) {
        if (!r.campaign_name) continue;
        const label = tag === "demo"
          ? `${r.age || "?"} ${r.gender || "?"}`
          : String(r.impression_device || "unknown");
        const q = `brk:${tag} ${label}`;
        push("impressions", toNumber(r.impressions), "int", { date: r.date_start, entity: r.campaign_name, qualifier: q });
        push("clicks", toNumber(r.clicks), "int", { date: r.date_start, entity: r.campaign_name, qualifier: q });
        push("spend", toNumber(r.spend), "usd", { date: r.date_start, entity: r.campaign_name, qualifier: q });
      }
    } catch (e) { console.warn(`Meta ${tag} breakdown ${src.slug}: ${e.message}`); }
  }

  // 5) AD QUALITY rankings — categorical strings, not numbers, so they live in their
  // own table rather than being encoded into a numeric metric.
  try {
    const q = await metaInsights(src.external_id,
      "level=ad&fields=campaign_name,adset_name,ad_name,ad_id,quality_ranking,"
      + "engagement_rate_ranking,conversion_rate_ranking");
    const qrows = q.filter(r => r.quality_ranking || r.engagement_rate_ranking || r.conversion_rate_ranking)
      .map(r => ({
        account_ext_id: src.external_id, metric_date: r.date_start,
        campaign: r.campaign_name || "", ad_set: r.adset_name || "",
        ad_name: r.ad_name || "", ad_id: r.ad_id || "",
        quality_ranking: r.quality_ranking || null,
        engagement_rate_ranking: r.engagement_rate_ranking || null,
        conversion_rate_ranking: r.conversion_rate_ranking || null,
      }));
    if (qrows.length) {
      for (let i = 0; i < qrows.length; i += 500) {
        await sb("meta_ad_quality?on_conflict=account_ext_id,metric_date,ad_id",
          { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(qrows.slice(i, i + 500)) });
      }
    }
  } catch (e) { console.warn(`Meta quality ${src.slug}: ${e.message}`); }
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

// ---- Google Ads (direct API) -------------------------------------------------------
// Port of orchestrator/gads/_body.js — same GAQL, same row grain, same qualifier
// markers, so API rows and script rows land on the same primary key and are
// interchangeable. One query per report type over the whole START..END window;
// segments.date on every row gives the day.
//
// GRAIN CONTRACT (matches the reporting views):
//   qualifier = <ad group name>      -> authoritative counts (summed)
//   qualifier = "<channel type>"     -> campaign-level counts for PMax-style campaigns (summed)
//   qualifier = "rate"               -> campaign-level rates as Google computes them
//   qualifier = "ad:" / "term:" / "kw:" / "ag:" / "dev:" / "net:" / "age:" / "gender:"
//                                    -> non-additive breakouts (excluded from totals)
//
// Accounts granted directly to the user (outside the MCC) are read with themselves as
// login customer (gadsQuery selfLogin). A 403 that survives that retry means the token's
// user genuinely has no access — reported, not pulled.
const isOutsideMcc = (e) => /403 .*permission to access customer/i.test(e?.message || "");
const gNum = (v) => (v == null ? null : Number(v));
const gMicros = (v) => (v == null ? null : Number(v) / 1e6);
const gPct = (v) => (v == null ? null : Number(v) * 100);

// Additive counts. Several report resources are ad-group-level (age_range_view,
// gender_view, keyword_view, ad_group_ad, search_term_view), so one (day, campaign,
// qualifier) key can receive several rows — one per ad group. Those are summed: the
// campaign's total for that age bucket / keyword / device is exactly the sum of its ad
// groups' numbers, which is what Google itself reports at campaign grain. Rates are
// never summed. (The script path picked an arbitrary one of the colliding rows.)
const GADS_ADDITIVE = new Set(["impressions", "clicks", "spend", "conversions", "conversions_value",
  "all_conversions", "view_through_conversions", "phone_calls", "phone_impressions", "video_views"]);

async function pullGoogleAds(src) {
  if (!GADS_READY) return [];
  const cid = String(src.external_id).replace(/\D/g, "");
  const byKey = new Map();
  const push = (metric, day, entity, qualifier, value, unit, meta) => {
    if (value == null || Number.isNaN(Number(value))) return;
    const row = { metric_name: metric, metric_date: day, account_ext_id: cid,
      entity: entity || "", qualifier: qualifier || "", value: Number(value), unit, meta: meta || undefined };
    const key = `${metric}|${day}|${row.entity}|${row.qualifier}`;
    const prev = byKey.get(key);
    if (prev && GADS_ADDITIVE.has(metric)) prev.value += row.value; else byKey.set(key, row);
  };
  let splitsSkipped = false;
  const where = (extra) => `WHERE segments.date BETWEEN '${START}' AND '${END}' AND ${extra}`;
  const q = async (gaql) => gadsQuery(cid, gaql, { selfLogin: true });
  const guarded = async (label, fn) => { try { await fn(); } catch (e) { console.warn(`  google_ads ${src.slug}/${cid} ${label} skipped: ${e.message.slice(0, 160)}`); } };

  let core;
  try {
    // 1. AD GROUP: authoritative counts — unguarded on purpose (load-bearing)
    // (q() retries as the account's own login customer: all 12 outside-MCC accounts grant
    //  the token's user direct access — probed 2026-09-04, enabled on Matt's go.)
    core = await q("SELECT segments.date, campaign.name, campaign.advertising_channel_type, ad_group.name, "
      + "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, "
      + "metrics.all_conversions, metrics.view_through_conversions FROM ad_group " + where("metrics.impressions > 0"));
  } catch (e) {
    throw e;   // includes a 403 that survived the self-login retry: no access, fail loudly
  }
  const seenCampaignDay = new Set();
  for (const r of core) {
    const day = r.segments?.date, camp = r.campaign?.name || "", ag = r.adGroup?.name || "", m = r.metrics || {};
    const ct = String(r.campaign?.advertisingChannelType || "").toLowerCase(), mt = { ctype: ct };
    seenCampaignDay.add(`${day}|${camp}`);
    push("impressions", day, camp, ag, gNum(m.impressions), "int", mt);
    push("clicks", day, camp, ag, gNum(m.clicks), "int", mt);
    push("spend", day, camp, ag, gMicros(m.costMicros), "usd", mt);
    push("conversions", day, camp, ag, gNum(m.conversions), "int", mt);
    push("conversions_value", day, camp, ag, gNum(m.conversionsValue), "usd", mt);
    push("all_conversions", day, camp, ag, gNum(m.allConversions), "int", mt);
    push("view_through_conversions", day, camp, ag, gNum(m.viewThroughConversions), "int", mt);
  }

  // 2. CAMPAIGN-level counts for campaigns with no ad groups (PMax etc.) — unguarded
  const camps = await q("SELECT segments.date, campaign.name, campaign.advertising_channel_type, metrics.impressions, "
    + "metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.all_conversions, "
    + "metrics.view_through_conversions FROM campaign " + where("metrics.impressions > 0"));
  for (const r of camps) {
    const day = r.segments?.date, camp = r.campaign?.name || "", m = r.metrics || {};
    if (seenCampaignDay.has(`${day}|${camp}`)) continue;
    const ct = String(r.campaign?.advertisingChannelType || "campaign").toLowerCase(), mt = { ctype: ct };
    push("impressions", day, camp, ct, gNum(m.impressions), "int", mt);
    push("clicks", day, camp, ct, gNum(m.clicks), "int", mt);
    push("spend", day, camp, ct, gMicros(m.costMicros), "usd", mt);
    push("conversions", day, camp, ct, gNum(m.conversions), "int", mt);
    push("conversions_value", day, camp, ct, gNum(m.conversionsValue), "usd", mt);
    push("all_conversions", day, camp, ct, gNum(m.allConversions), "int", mt);
    push("view_through_conversions", day, camp, ct, gNum(m.viewThroughConversions), "int", mt);
  }

  // 3. CAMPAIGN rates + auction diagnostics + calls (qualifier='rate')
  await guarded("campaign rates", async () => {
    const rs = await q("SELECT segments.date, campaign.name, metrics.ctr, metrics.average_cpc, metrics.average_cpm, "
      + "metrics.cost_per_conversion, metrics.cost_per_all_conversions, metrics.conversions_from_interactions_rate, "
      + "metrics.value_per_conversion, metrics.interaction_rate, metrics.engagement_rate, metrics.search_impression_share, "
      + "metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, metrics.search_click_share, "
      + "metrics.absolute_top_impression_percentage, metrics.top_impression_percentage, metrics.phone_calls, "
      + "metrics.phone_impressions, metrics.phone_through_rate FROM campaign " + where("metrics.impressions > 0"));
    for (const r of rs) {
      const d = r.segments?.date, c = r.campaign?.name || "", m = r.metrics || {};
      push("ctr", d, c, "rate", gPct(m.ctr), "pct");
      push("cpc", d, c, "rate", gMicros(m.averageCpc), "usd");
      push("cpm", d, c, "rate", gMicros(m.averageCpm), "usd");
      push("cost_per_conversion", d, c, "rate", gMicros(m.costPerConversion), "usd");
      push("cost_per_all_conversions", d, c, "rate", gMicros(m.costPerAllConversions), "usd");
      push("conversion_rate", d, c, "rate", gPct(m.conversionsFromInteractionsRate), "pct");
      push("value_per_conversion", d, c, "rate", gNum(m.valuePerConversion), "usd");
      push("interaction_rate", d, c, "rate", gPct(m.interactionRate), "pct");
      push("engagement_rate", d, c, "rate", gPct(m.engagementRate), "pct");
      push("impression_share", d, c, "rate", gPct(m.searchImpressionShare), "pct");
      push("lost_is_budget", d, c, "rate", gPct(m.searchBudgetLostImpressionShare), "pct");
      push("lost_is_rank", d, c, "rate", gPct(m.searchRankLostImpressionShare), "pct");
      push("click_share", d, c, "rate", gPct(m.searchClickShare), "pct");
      push("top_impression_pct", d, c, "rate", gPct(m.absoluteTopImpressionPercentage), "pct");
      push("top_of_page_pct", d, c, "rate", gPct(m.topImpressionPercentage), "pct");
      push("phone_calls", d, c, "rate", gNum(m.phoneCalls), "int");
      push("phone_impressions", d, c, "rate", gNum(m.phoneImpressions), "int");
      push("phone_through_rate", d, c, "rate", gPct(m.phoneThroughRate), "pct");
    }
  });

  // 3b. VIDEO — field availability varies; widest set first, narrower fallbacks
  const videoSets = [
    "metrics.video_views, metrics.video_view_rate, metrics.average_cpv, metrics.video_quartile_p25_rate, "
      + "metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate",
    "metrics.video_views, metrics.video_view_rate",
    "metrics.video_views",
  ];
  for (let vi = 0; vi < videoSets.length; vi++) {
    try {
      const rs = await q(`SELECT segments.date, campaign.name, ${videoSets[vi]} FROM campaign ` + where("metrics.impressions > 0"));
      for (const r of rs) {
        const d = r.segments?.date, c = r.campaign?.name || "", m = r.metrics || {};
        push("video_views", d, c, "rate", gNum(m.videoViews), "int");
        push("video_view_rate", d, c, "rate", gPct(m.videoViewRate), "pct");
        push("cpv", d, c, "rate", gMicros(m.averageCpv), "usd");
        push("video_p25_rate", d, c, "rate", gPct(m.videoQuartileP25Rate), "pct");
        push("video_p50_rate", d, c, "rate", gPct(m.videoQuartileP50Rate), "pct");
        push("video_p75_rate", d, c, "rate", gPct(m.videoQuartileP75Rate), "pct");
        push("video_p100_rate", d, c, "rate", gPct(m.videoQuartileP100Rate), "pct");
      }
      break;
    } catch (e) { if (vi === videoSets.length - 1 && !pullGoogleAds._videoWarned) { pullGoogleAds._videoWarned = true;
      console.warn(`  google_ads: video metrics not served on the campaign resource by ${_gadsVersion} (${e.message.slice(0, 80)}) — skipped for all accounts`); } }
  }

  // 4. ACCOUNT-level rates (entity='' qualifier='')
  await guarded("account rates", async () => {
    const rs = await q("SELECT segments.date, metrics.ctr, metrics.average_cpc, metrics.average_cpm, metrics.cost_per_conversion, "
      + "metrics.conversions_from_interactions_rate FROM customer " + where("metrics.impressions >= 0"));
    for (const r of rs) {
      const d = r.segments?.date, m = r.metrics || {};
      push("ctr", d, "", "", gPct(m.ctr), "pct");
      push("cpc", d, "", "", gMicros(m.averageCpc), "usd");
      push("cpm", d, "", "", gMicros(m.averageCpm), "usd");
      push("cost_per_conversion", d, "", "", gMicros(m.costPerConversion), "usd");
      push("conversion_rate", d, "", "", gPct(m.conversionsFromInteractionsRate), "pct");
    }
  });

  // 5. AD level (drill)
  await guarded("ad drill", async () => {
    const rs = await q("SELECT segments.date, campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, "
      + "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ad_group_ad " + where("metrics.impressions > 0"));
    // unnamed ads read as their type ("EXPANDED_DYNAMIC_SEARCH_AD"), so several ads in one
    // group can share a label; add the ad id only when that happens (same rule as Meta).
    const labelCount = new Map();
    for (const r of rs) {
      const k = `${r.segments?.date}|${r.campaign?.name}|${r.adGroup?.name}|${r.adGroupAd?.ad?.name || r.adGroupAd?.ad?.type}`;
      labelCount.set(k, (labelCount.get(k) || 0) + 1);
    }
    for (const r of rs) {
      const d = r.segments?.date, c = r.campaign?.name || "", m = r.metrics || {};
      const adName = r.adGroupAd?.ad?.name || r.adGroupAd?.ad?.type || "(unnamed ad)";
      const k = `${d}|${c}|${r.adGroup?.name}|${r.adGroupAd?.ad?.name || r.adGroupAd?.ad?.type}`;
      const qq = `ad:${r.adGroup?.name || ""} › ${adName}${labelCount.get(k) > 1 && r.adGroupAd?.ad?.id ? ` [${r.adGroupAd.ad.id}]` : ""}`;
      push("impressions", d, c, qq, gNum(m.impressions), "int");
      push("clicks", d, c, qq, gNum(m.clicks), "int");
      push("spend", d, c, qq, gMicros(m.costMicros), "usd");
      push("conversions", d, c, qq, gNum(m.conversions), "int");
    }
  });

  // 6–10. breakouts: search terms, keywords (+quality), PMax asset groups, device, network, age, gender
  const breakout = async (label, gaql, qualOf, extra) => guarded(label, async () => {
    const rs = await q(gaql);
    for (const r of rs) {
      const d = r.segments?.date, c = r.campaign?.name || "", m = r.metrics || {}, qq = qualOf(r);
      push("impressions", d, c, qq, gNum(m.impressions), "int");
      push("clicks", d, c, qq, gNum(m.clicks), "int");
      push("spend", d, c, qq, gMicros(m.costMicros), "usd");
      push("conversions", d, c, qq, gNum(m.conversions), "int");
      if (extra) extra(r, d, c, qq, m);
    }
  });
  const M4 = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions";
  // Non-additive splits (term/kw/dev/net/age/gender) are pruned after 90 days, same as
  // Meta's brk: rows — so for a window already outside that horizon they are not pulled
  // at all (~300k rows/month that the nightly prune would delete). WRITE_BREAKOUTS=1 forces.
  await breakout("asset groups",   // PMax asset groups: kept long-term (the only way inside PMax)
    `SELECT segments.date, campaign.name, asset_group.name, ${M4}, metrics.conversions_value FROM asset_group ` + where("metrics.impressions > 0"),
    (r) => `ag:${r.assetGroup?.name || "(unnamed)"}`,
    (r, d, c, qq, m) => push("conversions_value", d, c, qq, gNum(m.conversionsValue), "usd"));
  // Search-term / keyword / device / network / age / gender splits are NOT core data
  // (Matt, 2026-09-04: "really just need core data") and are ~10× the volume of everything
  // else. Pulled only for accounts opted in with client_sources.params.metric_depth='full'
  // — the same switch as Meta — and, like Meta's brk: rows, only inside the 90-day horizon.
  const wantSplits = src.params?.metric_depth === "full" && WRITE_BREAKOUTS;
  if (!wantSplits) { splitsSkipped = true; } else {
  await breakout("search terms",
    `SELECT segments.date, campaign.name, search_term_view.search_term, ${M4} FROM search_term_view ` + where("metrics.impressions > 0"),
    (r) => `term:${r.searchTermView?.searchTerm || "(unknown)"}`);
  await breakout("keywords",
    "SELECT segments.date, campaign.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, "
      + "ad_group_criterion.quality_info.quality_score, ad_group_criterion.quality_info.creative_quality_score, "
      + "ad_group_criterion.quality_info.post_click_quality_score, ad_group_criterion.quality_info.search_predicted_ctr, "
      + `${M4} FROM keyword_view ` + where("metrics.impressions > 0"),
    (r) => { const kw = r.adGroupCriterion?.keyword || {}; return `kw:${kw.text || "(unknown)"}${kw.matchType ? ` [${kw.matchType}]` : ""}`; },
    (r, d, c, qq) => {
      const qi = r.adGroupCriterion?.qualityInfo;
      if (qi?.qualityScore) push("quality_score", d, c, qq, gNum(qi.qualityScore), "int");
      if (qi && (qi.creativeQualityScore || qi.postClickQualityScore || qi.searchPredictedCtr)) {
        push("quality_components", d, c, qq, 1, "int", { ad_relevance: qi.creativeQualityScore || null,
          landing_page: qi.postClickQualityScore || null, expected_ctr: qi.searchPredictedCtr || null });
      }
    });
  await breakout("device",
    `SELECT segments.date, campaign.name, segments.device, ${M4} FROM campaign ` + where("metrics.impressions > 0"),
    (r) => `dev:${String(r.segments?.device || "UNKNOWN").toLowerCase()}`);
  await breakout("network",
    `SELECT segments.date, campaign.name, segments.ad_network_type, ${M4} FROM campaign ` + where("metrics.impressions > 0"),
    (r) => `net:${String(r.segments?.adNetworkType || "UNKNOWN").toLowerCase()}`);
  await breakout("age",
    `SELECT segments.date, campaign.name, ad_group_criterion.age_range.type, ${M4} FROM age_range_view ` + where("metrics.impressions > 0"),
    (r) => `age:${String(r.adGroupCriterion?.ageRange?.type || "UNKNOWN").replace(/^AGE_RANGE_/, "").toLowerCase()}`);
  await breakout("gender",
    `SELECT segments.date, campaign.name, ad_group_criterion.gender.type, ${M4} FROM gender_view ` + where("metrics.impressions > 0"),
    (r) => `gender:${String(r.adGroupCriterion?.gender?.type || "UNKNOWN").replace(/^GENDER_/, "").toLowerCase()}`);
  }

  // 11. CONVERSION ACTIONS (name + category)
  await guarded("conversion actions", async () => {
    const rs = await q("SELECT segments.date, campaign.name, segments.conversion_action_name, segments.conversion_action_category, "
      + "metrics.conversions, metrics.conversions_value FROM campaign " + where("metrics.conversions > 0"));
    for (const r of rs) {
      const d = r.segments?.date, c = r.campaign?.name || "", sc = r.segments || {}, m = r.metrics || {};
      const name = sc.conversionActionName || "(unknown)";
      const meta = sc.conversionActionCategory ? { category: String(sc.conversionActionCategory).toLowerCase() } : undefined;
      push("conversion_action", d, c, name, gNum(m.conversions), "int", meta);
      push("conversion_action_value", d, c, name, gNum(m.conversionsValue), "usd", meta);
    }
  });

  if (splitsSkipped && !pullGoogleAds._splitNote) { pullGoogleAds._splitNote = true;
    console.log(`  google_ads: term/kw/dev/net/age/gender splits not pulled (standard depth, or window outside the 90-day horizon)`); }
  return [...byKey.values()];
}

const PULLERS = { callrail: pullCallRail, ga4: pullGA4, meta: pullMeta, pages: pullPages, google_ads: pullGoogleAds };

// Pull + ingest for a set of client_sources rows (optionally one source only).
// Used by the main run and by the integrity sentinel's gap sweeps.
async function pullWindow(sources, onlySource, tally, mark) {
  let fails = 0, rows_in = 0;
  await mapLimit(sources.filter(s => PULLERS[s.source] && (!onlySource || s.source === onlySource)), 5, async (s) => {
    const src = { ...s, slug: s.clients.slug };
    try {
      const rows = await PULLERS[src.source](src);
      const n = await ingest(src.source, src.slug, rows.filter(r => r.value != null));
      rows_in += n;
      if (tally) tally[src.source] = (tally[src.source] || 0) + n;
      if (mark) mark(src.source, true);
    } catch (e) { console.error(`  ! ${src.slug}/${src.source}: ${e.message}`); fails++; if (mark) mark(src.source, false); }
  });
  return { rows: rows_in, fails };
}

const PROBE_ONLY = process.env.PROBE_ONLY === "1" || process.env.PROBE_ONLY === "true";

// Backfill runner. One claimed chunk = one source (or all) × one client (or all) × one
// calendar month. Rate-limit answers are recognised by their text and turned into a
// deferral rather than an error, so the job resumes by itself when the quota resets.
const RUN_URL = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
const retryAfterSeconds = (msg) => { const m = /Retry in (\d+) seconds/i.exec(msg || ""); return m ? Number(m[1]) : null; };

async function runBackfillChunks(allSources) {
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const claimed = await sb("rpc/claim_backfill_chunk", { method: "POST", body: "{}" });
    const c = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!c || !c.chunk_id) { console.log(i === 0 ? "Backfill: nothing claimable right now." : `Backfill: queue drained after ${i} chunk(s).`); return; }
    START = c.chunk_start; END = c.chunk_end; recomputeBreakouts();
    const scope = allSources.filter((s) => (!c.client_slug || s.clients.slug === c.client_slug));
    console.log(`Backfill chunk #${c.chunk_id}: ${c.source || "all sources"} · ${c.client_slug || "all clients"} · ${START}..${END} (${scope.length} mapping(s))`);
    const errors = [];
    let rows = 0;
    await mapLimit(scope.filter((s) => PULLERS[s.source] && (!c.source || s.source === c.source)), 5, async (s) => {
      const src = { ...s, slug: s.clients.slug };
      try {
        const r = await PULLERS[src.source](src);
        rows += await ingest(src.source, src.slug, r.filter((x) => x.value != null));
      } catch (e) { errors.push(`${src.slug}/${src.source}: ${e.message}`); }
    });
    const rateLimited = errors.map(retryAfterSeconds).filter(Boolean);
    let status = "done", err = null, retry = null;
    if (rateLimited.length) { status = "deferred"; retry = Math.max(...rateLimited) + 300; err = `rate limited — ${rateLimited.length} account(s) told to retry in ${Math.round(retry / 3600)} h`; }
    else if (errors.length) { status = "error"; err = `${errors.length} failure(s): ${errors.slice(0, 3).join(" | ")}`; }
    await sb("rpc/complete_backfill_chunk", { method: "POST", body: JSON.stringify({
      p_chunk: c.chunk_id, p_status: status, p_rows: rows, p_error: err, p_retry_seconds: retry, p_run_url: RUN_URL }) });
    console.log(`  → ${status}: ${rows} rows${err ? ` · ${err}` : ""}`);
    if (status === "deferred") return;          // no point claiming the next one from the same source
  }
}

async function main() {
  console.log(PROBE_ONLY
    ? "Connection test (probe only — no pulls)"
    : `Orchestrator run ${START}..${END} (America/New_York)`);
  let sources = await sb(
    "client_sources?select=source,external_id,params,active,clients!inner(slug,status)&active=eq.true&clients.status=eq.active"
  );
  if (ONLY_SLUG) {
    sources = sources.filter((s) => s.clients.slug === ONLY_SLUG);
    console.log(`ONLY_SLUG=${ONLY_SLUG} → ${sources.length} source(s)`);
    if (!sources.length) console.warn("  ! no active sources match that slug — nothing to pull");
  }
  const tally = {}, health = {}; // health[source] = {ok, fail}
  const mark = (source, ok) => { const h = health[source] = health[source] || { ok: 0, fail: 0 }; ok ? h.ok++ : h.fail++; };

  if (BACKFILL_MODE) { await runBackfillChunks(sources); return; }

  // bounded parallelism: 5 concurrent pulls. google_ads is pulled by API for MCC accounts
  // when GOOGLE_ADS_* is configured; accounts outside the MCC still arrive via their
  // own Ads Script posting directly.
  // A source a vendor has told us to back off from (recorded by the backfill runner as a
  // deferred chunk) is skipped today rather than failing 25 accounts and emailing about it;
  // the 14-day sentinel re-pulls the missed day once the quota is back.
  let daily = sources;
  try {
    const parked = await sb("backfill_chunks?select=retry_after,backfill_jobs(source)&status=eq.deferred&retry_after=gt." + new Date().toISOString());
    const parkedSources = new Set((parked || []).map((r) => r.backfill_jobs?.source).filter(Boolean));
    if (parkedSources.size) {
      console.warn(`Skipping ${[...parkedSources].join(", ")} today — vendor asked us to retry later (until ${(parked || []).map((r) => r.retry_after).sort().at(-1)}); sentinel heals the gap`);
      daily = sources.filter((s) => !parkedSources.has(s.source));
    }
  } catch (e) { /* never block the run on this check */ }
  if (!PROBE_ONLY) await pullWindow(daily, ONLY_SOURCE || null, tally, mark);

  console.log("Ingested rows:", JSON.stringify(tally));
  console.log("Source health:", JSON.stringify(health));

  // credential health self-report: ask Facebook how long the Meta token has left
  // (debug_token introspection) and write it to connector_status for the dashboard.
  try {
    const statusRows = [];
    if (META_ACCESS_TOKEN) {
      const r = await fetchT(`https://graph.facebook.com/v21.0/debug_token?input_token=${META_ACCESS_TOKEN}&access_token=${META_ACCESS_TOKEN}`);
      const body = await r.json().catch(() => ({}));
      const d = body?.data || {};
      const topErr = body?.error;
      // A throttled or failed introspection call says nothing about the token. Only
      // Facebook's own verdict (data.is_valid === false, or an OAuth error code 190) may
      // mark it expired — this run's real reads (16 ad accounts) are the better evidence.
      // (2026-09-04: a day of manual runs tripped the app rate limit and a "{}" answer was
      // reported as "expired" — a false alarm that went out by email.)
      const throttled = topErr && (topErr.code === 4 || topErr.code === 17 || topErr.code === 32 || topErr.code === 613 || /request limit/i.test(topErr.message || ""));
      const verdictKnown = d.is_valid === true || d.is_valid === false || (topErr && topErr.code === 190);
      if (!verdictKnown) {
        console.warn(`Meta token introspection unavailable this run (${throttled ? "rate limited" : (topErr?.message || "empty answer")}) — status left as-is`);
      } else {
        const clocks = [d.expires_at, d.data_access_expires_at].filter((x) => x > 0);
        statusRows.push({
          provider: "meta",
          status: d.is_valid ? "ok" : "expired",
          expires_at: clocks.length ? new Date(Math.min(...clocks) * 1000).toISOString() : null,
          detail: d.is_valid
            ? `user token${d.expires_at === 0 ? " (session non-expiring; limit is data access)" : ""} · scopes: ${(d.scopes || []).join(", ")}`
            : (d.error?.message || topErr?.message || "Facebook reports the token invalid"),
        });
      }
    }
    statusRows.push({ provider: "google_oauth", status: health.ga4 && health.ga4.ok > 0 ? "ok" : "unknown",
      expires_at: null, detail: "refresh token — no fixed expiry (dies only if revoked)" });
    statusRows.push({ provider: "callrail", status: health.callrail && health.callrail.ok > 0 ? "ok" : "unknown",
      expires_at: null, detail: "static API key — no fixed expiry" });
    if (statusRows.length) {
      await fetchT(`${SUPABASE_URL}/functions/v1/connector-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${INGEST_TOKEN}` },
        body: JSON.stringify({ rows: statusRows }),
      });
      const meta = statusRows.find((s) => s.provider === "meta");
      if (meta?.expires_at) {
        const days = Math.round((new Date(meta.expires_at) - Date.now()) / 864e5);
        console.log(`Meta token: ${meta.status}, expires ${meta.expires_at.slice(0, 10)} (${days}d)`);
      }
    }
  } catch (e) { console.warn("connector-status report failed:", e.message); }
  // a source where EVERY pull failed = red run (surface it, don't exit green)
  const deadSources = Object.entries(health).filter(([, h]) => h.fail > 0 && h.ok === 0).map(([k]) => k);
  if (deadSources.length) process.exitCode = 1;
  // ---- integrity sentinel: detect gaps in the last 14 days and self-heal ----
  // Any (source, day) with zero rows across the whole book gets re-pulled on the
  // spot. A day that re-pulls cleanly but stays empty is "verified empty" (the
  // platforms genuinely report nothing), not a gap. google_ads is push-only, so
  // its gaps can only be flagged (heal = run the backfill script from the MCC).
  try {
    if (PROBE_ONLY) throw { skip: true };
    const gaps = await sb("rpc/data_gaps", { method: "POST", body: JSON.stringify({ p_days: 14 }) });
    // google_ads gaps are healable by API for MCC accounts; script-fed accounts are
    // skipped inside pullGoogleAds, so a gap that stays after the sweep is theirs.
    const healable = gaps.filter(g => g.source !== "google_ads" || GADS_READY);
    let healedRows = 0, sweepFails = 0;
    if (healable.length) {
      console.log(`Sentinel: ${gaps.length} gap-day(s) found, ${healable.length} healable — sweeping...`);
      const bySource = {};
      healable.forEach(g => (bySource[g.source] = bySource[g.source] || []).push(g.gap_date));
      for (const [srcName, dates] of Object.entries(bySource)) {
        dates.sort();
        let i = 0;
        while (i < dates.length) {
          let j = i; // batch contiguous days into one pull window
          while (j + 1 < dates.length && new Date(dates[j + 1]) - new Date(dates[j]) === 864e5) j++;
          START = dates[i]; END = dates[j];
          console.log(`Sentinel sweep: ${srcName} ${START}..${END}`);
          const r = await pullWindow(sources, srcName, null, null);
          healedRows += r.rows; sweepFails += r.fails;
          i = j + 1;
        }
      }
    }
    const remaining = healable.length || gaps.length
      ? await sb("rpc/data_gaps", { method: "POST", body: JSON.stringify({ p_days: 14 }) }) : [];
    const gadsGaps = remaining.filter(g => g.source === "google_ads");
    const verifiedEmpty = remaining.filter(g => g.source !== "google_ads");
    const status = sweepFails > 0 ? "issues" : gadsGaps.length ? "attention" : "ok";
    await sb("integrity_checks", { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, gaps_found: gaps.length, rows_healed: healedRows,
        summary: {
          window_days: 14, sweep_failures: sweepFails,
          google_ads_gaps: gadsGaps.map(g => g.gap_date),
          verified_empty: verifiedEmpty.map(g => `${g.source} ${g.gap_date}`),
        } }) });
    console.log(`Sentinel: ${status} — ${gaps.length} gap(s), ${healedRows} rows re-pulled`
      + (gadsGaps.length ? `; google_ads gaps need MCC backfill: ${gadsGaps.map(g => g.gap_date).join(", ")}` : ""));
  } catch (e) { if (!e?.skip) console.warn("sentinel failed:", e.message); }

  // Issue collector — every problem found this run goes in here, and ONE digest
  // email goes out at the end. An outage should page you once with everything,
  // not twelve times with fragments.
  const issues = [];
  const issue = (severity, key, title, detail) => issues.push({ severity, key, title, detail });

  // ---- connection smoke test: probe EVERY mapped account, active or not ----
  // Cheap metadata call per account. Catches two things the sync alone cannot:
  //  * an ACTIVE account that has silently become unreachable (credential/permission)
  //  * an INACTIVE account that is now reachable — i.e. parked on a stale reason
  //    (Every Child TN hid this way for 7 weeks)
  async function probeOne(s) {
    const slug = s.clients.slug, src = s.source, ext = String(s.external_id);
    try {
      if (src === "meta") {
        if (!META_ACCESS_TOKEN) return [false, "no META_ACCESS_TOKEN"];
        const r = await fetchT(`${META_API}/act_${ext.replace(/^act_/, "")}?fields=name,account_status&access_token=${META_ACCESS_TOKEN}`, {}, 15000);
        const d = await r.json();
        return d.error ? [false, d.error.message.slice(0, 160)]
          : [true, `${d.name || "ad account"}${d.account_status === 1 ? "" : ` (status ${d.account_status})`}`];
      }
      if (src === "pages") {
        if (!META_ACCESS_TOKEN) return [false, "no META_ACCESS_TOKEN"];
        // light read — asking for access_token on 18 pages trips Meta's app rate limit
        const r = await fetchT(`${META_API}/${ext}?fields=name&access_token=${META_ACCESS_TOKEN}`, {}, 15000);
        const d = await r.json();
        if (d.error) {
          // a rate-limit answer says nothing about reachability — don't cry wolf
          if (d.error.code === 4 || d.error.code === 17 || /request limit/i.test(d.error.message || ""))
            return [true, "rate-limited by Meta — not tested this run"];
          return [false, d.error.message.slice(0, 160)];
        }
        return [true, d.name || "page"];
      }
      if (src === "ga4") {
        if (!GOOGLE_READY) return [false, "no GOOGLE_OAUTH_*"];
        const tok = await getGoogleToken();
        // probe with the DATA API (the one we actually pull with); the Admin API
        // isn't enabled on this Cloud project and would give a false negative.
        const r = await fetchT(`https://analyticsdata.googleapis.com/v1beta/properties/${ext}:runReport`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
          body: JSON.stringify({ dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }],
            metrics: [{ name: "sessions" }], limit: 1 }),
        }, 20000);
        const d = await r.json();
        if (d.error) return [false, String(d.error.message).slice(0, 160)];
        const n = d.rows?.[0]?.metricValues?.[0]?.value;
        return [true, `property ${ext}${n != null ? ` · ${n} sessions/7d` : ""}`];
      }
      if (src === "callrail") {
        if (!CALLRAIL_API_KEY) return [false, "no CALLRAIL_API_KEY"];
        const acct = s.params?.account_id;
        if (!acct) return [false, "no account_id in mapping"];
        const r = await fetchT(`https://api.callrail.com/v3/a/${acct}/companies/${ext}.json`,
          { headers: { Authorization: `Token token=${CALLRAIL_API_KEY}` } }, 15000);
        const d = await r.json().catch(() => ({}));
        return r.ok && !d.error ? [true, d.name || "company"] : [false, JSON.stringify(d.error || d).slice(0, 160)];
      }
      if (src === "google_ads" && GADS_READY) {
        // direct API: can this credential read the account at all? Accounts outside the
        // MCC answer 403 — they are script-fed by decision, so fall through to that probe.
        try {
          const rs = await gadsQuery(ext, "SELECT customer.descriptive_name, customer.currency_code, customer.status FROM customer LIMIT 1", { selfLogin: true });
          const c = rs[0]?.customer || {};
          return [true, `API${rs.viaLogin === "direct" ? " (direct access, outside MCC)" : ""} · ${c.descriptiveName || "account"} · ${c.currencyCode || ""}${c.status && c.status !== "ENABLED" ? ` (${c.status})` : ""}`];
        } catch (e) {
          // a quota answer says nothing about access — don't cry wolf (same rule as Pages)
          if (/\b429\b|Too many requests/i.test(e.message)) return [true, "rate-limited by Google Ads API — not tested this run"];
          if (!isOutsideMcc(e)) throw e;
        }
      }
      if (src === "google_ads") {
        // push-based fallback: "reachable" = the Ads Script has posted for this account recently
        const rows = await sb(`metrics_daily?select=metric_date&source=eq.google_ads`
          + `&account_ext_id=ilike.*${ext.replace(/\D/g, "").slice(-4)}*&order=metric_date.desc&limit=1`);
        const last = rows?.[0]?.metric_date;
        const fresh = last && (Date.now() - new Date(last)) < 5 * 864e5;
        return [!!fresh, last ? `script-fed (outside MCC) · last post ${last}` : "script-fed (outside MCC) · no data ever posted"];
      }
      return [true, "no probe for this source"];
    } catch (e) { return [false, e.message.slice(0, 160)]; }
  }

  try {
    const allMappings = await sb(
      "client_sources?select=source,external_id,params,active,clients!inner(slug,status)&clients.status=eq.active");
    // Meta counts every call against one app-level limit; probe gently.
    const verdicts = await mapLimit(allMappings, 2, async (s) => {
      const [ok, detail] = await probeOne(s);
      const v = await sb("rpc/record_probe", { method: "POST", body: JSON.stringify({
        p_slug: s.clients.slug, p_source: s.source, p_ext: String(s.external_id),
        p_active: !!s.active, p_reachable: ok, p_detail: detail }) });
      return { slug: s.clients.slug, source: s.source, ext: s.external_id, active: s.active, ok, detail, verdict: v };
    });

    const broken = verdicts.filter(v => v.verdict === "newly_broken" && v.active);
    const opportunities = verdicts.filter(v => v.verdict === "new_reachable");
    const recovered = verdicts.filter(v => v.verdict === "recovered" && v.active);
    const unreachableActive = verdicts.filter(v => v.active && !v.ok);
    console.log(`Probe: ${verdicts.length} mappings — ${unreachableActive.length} active unreachable,`
      + ` ${opportunities.length} inactive-but-reachable, ${broken.length} newly broken`);

    for (const b of broken) {
      issue("critical", `broken:${b.slug}:${b.source}:${b.ext}`,
        `${b.slug} / ${b.source} connection BROKEN`,
        `${b.ext} — ${b.detail} (was reachable on the previous probe)`);
    }
    if (opportunities.length) {
      issue("info", `opportunity:${opportunities.map(o => o.ext).sort().join(",")}`,
        `${opportunities.length} parked account${opportunities.length === 1 ? "" : "s"} now reachable`,
        opportunities.map(o => `${o.slug} / ${o.source} ${o.ext} — ${o.detail}`).join("\n"));
    }
    for (const r of recovered) {
      issue("info", `recovered:${r.slug}:${r.source}:${r.ext}`,
        `${r.slug} / ${r.source} recovered`, `${r.ext} — ${r.detail}`);
    }
    // standing problems matter even when they aren't NEW — one aggregated line,
    // not one email per account (dedupe means this re-notifies once a day).
    const stillDown = unreachableActive.filter(v => v.verdict !== "newly_broken");
    if (stillDown.length) {
      const bySource = {};
      stillDown.forEach(v => (bySource[v.source] = bySource[v.source] || []).push(v));
      issue("warning", `still_down:${stillDown.map(v => v.ext).sort().join(",").slice(0, 150)}`,
        `${stillDown.length} account${stillDown.length === 1 ? "" : "s"} still not reporting`,
        Object.entries(bySource).map(([src, list]) =>
          `${src} (${list.length}): ` + list.map(v => `${v.slug} ${v.ext} — ${v.detail}`).join("; ")
        ).join("\n"));
    }
  } catch (e) { console.warn("connection probe failed:", e.message); }

  // ---- error-flow alerts: email on the failures that actually matter ----
  // Deduped in the DB (same alert once per window) so an outage pages us daily,
  // not every run. Alerting never throws — a broken alert must not break a sync.
  try {
    // 1) a source where every pull failed
    for (const src of deadSources) {
      issue("critical", `dead:${src}`, `${src} sync failed — every pull errored`,
        `0 of ${health[src].fail} ${src} pulls succeeded on ${START}..${END}. Usually an expired credential.`);
    }
    // 2) partial failures worth knowing about (some accounts blocked, not all)
    for (const [src, h] of Object.entries(health)) {
      if (h.fail > 0 && h.ok > 0) {
        issue("warning", `partial:${src}:${h.fail}`, `${src}: ${h.fail} of ${h.ok + h.fail} pulls failed`,
          `Partial failure — usually per-account permissions rather than a dead credential.`);
      }
    }
    // 3) credential expiry warnings (read what we just wrote to connector_status)
    const creds = await sb("connector_status?select=provider,status,expires_at");
    for (const c of (creds || [])) {
      if (c.status === "expired") {
        issue("critical", `cred_expired:${c.provider}`, `${c.provider} credential EXPIRED`,
          `Rejected by the provider — pulls for it are failing now. Mint a new token and update the GitHub secret.`);
      } else if (c.expires_at) {
        const days = Math.round((new Date(c.expires_at) - Date.now()) / 864e5);
        if (days <= 14 && days > 0) {
          issue(days <= 3 ? "warning" : "info", `cred_expiring:${c.provider}:${days > 7 ? "14d" : days > 3 ? "7d" : "3d"}`,
            `${c.provider} credential expires in ${days} day${days === 1 ? "" : "s"}`,
            `Expires ${String(c.expires_at).slice(0, 10)} — rotate before then to avoid a silent gap.`);
        }
      }
    }
    // 4) integrity sentinel verdict (only when it isn't clean)
    const lastCheck = await sb("integrity_checks?select=status,gaps_found,summary&order=checked_at.desc&limit=1");
    const ic = lastCheck?.[0];
    if (ic && ic.status !== "ok") {
      issue(ic.status === "issues" ? "critical" : "warning",
        `integrity:${ic.status}:${JSON.stringify(ic.summary?.google_ads_gaps || [])}`,
        `Data integrity: ${ic.status}`,
        `${ic.gaps_found} gap-day(s). ${JSON.stringify(ic.summary)}`);
    }
  } catch (e) { console.warn("alerting block failed:", e.message); }

  // ---- one digest email for everything found this run ----
  try {
    if (issues.length) {
      const rank = { critical: 0, warning: 1, info: 2 };
      issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
      const crit = issues.filter(i => i.severity === "critical").length;
      const warn = issues.filter(i => i.severity === "warning").length;
      const icon = crit ? "🔴" : warn ? "🟠" : "🔵";
      const headline = issues[0].title;
      const subject = issues.length === 1
        ? `${icon} Deksia pipeline: ${headline}`
        : `${icon} Deksia pipeline: ${issues.length} issues — ${headline}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}`;
      const section = (sev, label) => {
        const list = issues.filter(i => i.severity === sev);
        return list.length ? `\n${label}\n` + list.map(i => `• ${i.title}\n  ${i.detail.replace(/\n/g, "\n  ")}`).join("\n") + "\n" : "";
      };
      const body = `Run ${START}..${END}${PROBE_ONLY ? " (connection test)" : ""}\n`
        + section("critical", "CRITICAL — data is not flowing")
        + section("warning", "WARNING — degraded")
        + section("info", "FYI")
        + `\nSource health: ${JSON.stringify(health)}`
        + `\nRows ingested: ${JSON.stringify(tally)}`
        + `\n\nPipeline health: https://deksia-v2-reporting.vercel.app/pipeline`;
      // dedupe on the SET of issues: an unchanged outage re-notifies once a day,
      // but any new problem changes the key and emails immediately.
      const key = issues.map(i => i.key).sort().join("|").slice(0, 200);
      await sb("rpc/send_alert", { method: "POST", body: JSON.stringify({
        p_kind: "digest", p_subject: subject, p_body: body, p_dedupe_key: key, p_dedupe_hours: 24 }) });
      console.log(`Digest: ${issues.length} issue(s) — ${crit} critical, ${warn} warning`);
    } else {
      console.log("Digest: nothing to report — all clear.");
    }
  } catch (e) { console.warn("digest failed:", e.message); }

  if (PROBE_ONLY) { console.log("Probe-only run complete."); return; }
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
