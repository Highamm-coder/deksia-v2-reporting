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
let START = process.env.RUN_START || process.env.RUN_DATE || etDate(-1);
let END   = process.env.RUN_END   || process.env.RUN_DATE || etDate(-1);

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
      body: JSON.stringify({ source, client_slug: clientSlug, writer: "github-actions/run.mjs", rows: rows.slice(i, i + CHUNK) }),
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

async function pullMeta(src) {
  if (!META_ACCESS_TOKEN) return [];                       // skip until token configured
  const rows = [];
  const push = (name, val, unit, extra = {}) => {
    if (val != null) rows.push({ metric_name: name, metric_date: extra.date, value: val, unit,
      account_ext_id: src.external_id, entity: extra.entity || "", qualifier: extra.qualifier || "" });
  };

  // 1) counts at ad level
  const ads = await metaInsights(src.external_id,
    "level=ad&fields=campaign_name,adset_name,ad_name,ad_id,impressions,clicks,spend,actions");
  const seen = new Set(); // distinct ads can share a display name — disambiguate with Meta's ad_id
  for (const r of ads) {
    const date = r.date_start;
    const entity = r.campaign_name || "";
    let qualifier = `${r.adset_name || ""} › ${r.ad_name || ""}`;
    const key = `${date}|${entity}|${qualifier}`;
    if (seen.has(key)) qualifier += ` [${r.ad_id}]`;
    seen.add(key);
    const lead = (r.actions || []).find(a => a.action_type === "lead");
    const link = (r.actions || []).find(a => a.action_type === "link_click");
    push("impressions", toNumber(r.impressions), "int", { date, entity, qualifier });
    push("clicks",      toNumber(r.clicks), "int", { date, entity, qualifier });
    push("spend",       toNumber(r.spend), "usd", { date, entity, qualifier });
    push("leads",       lead ? Number(lead.value) : null, "int", { date, entity, qualifier });
    push("link_clicks", link ? Number(link.value) : null, "int", { date, entity, qualifier });
  }

  // 2) account-level metrics Meta reports as de-duplicated / computed totals — these are
  // NOT summable across ads (reach counts unique people; ctr/cpc/cpl are ratios), so they
  // live at account grain (entity='', qualifier='') exactly as Meta reports them per day.
  const acct = await metaInsights(src.external_id, "level=account&fields=ctr,cpc,reach,cost_per_action_type");
  for (const r of acct) {
    push("ctr",   toNumber(r.ctr), "pct", { date: r.date_start });
    push("cpc",   toNumber(r.cpc), "usd", { date: r.date_start });
    push("reach", toNumber(r.reach), "int", { date: r.date_start });
    // Meta's own cost-per-lead (cost_per_action_type where action_type='lead')
    const cpl = (r.cost_per_action_type || []).find(a => a.action_type === "lead");
    push("cost_per_lead", cpl ? Number(cpl.value) : null, "usd", { date: r.date_start });
  }

  // 3) CAMPAIGN-level rates, exactly as Meta computes them at that grain (not derived
  // from our ad rows). Stored with qualifier='rate' so they are a distinct grain:
  // the metric tables exclude them (they'd pollute the account-level averages) while
  // the campaign table shows them per campaign line.
  const camp = await metaInsights(src.external_id,
    "level=campaign&fields=campaign_name,ctr,cpc,cpm,frequency,reach,cost_per_action_type");
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
    const ccpl = (r.cost_per_action_type || []).find(a => a.action_type === "lead");
    put("cost_per_lead", ccpl ? Number(ccpl.value) : null, "usd");
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

const PULLERS = { callrail: pullCallRail, ga4: pullGA4, meta: pullMeta, pages: pullPages };

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

async function main() {
  console.log(`Orchestrator run ${START}..${END} (America/New_York)`);
  const sources = await sb(
    "client_sources?select=source,external_id,params,active,clients!inner(slug,status)&active=eq.true&clients.status=eq.active"
  );
  const tally = {}, health = {}; // health[source] = {ok, fail}
  const mark = (source, ok) => { const h = health[source] = health[source] || { ok: 0, fail: 0 }; ok ? h.ok++ : h.fail++; };

  // bounded parallelism: 5 concurrent pulls (google_ads is push-based via Ads Scripts)
  await pullWindow(sources, null, tally, mark);
  // (google_ads arrives via the Google Ads Scripts POSTing directly — not pulled here)

  console.log("Ingested rows:", JSON.stringify(tally));
  console.log("Source health:", JSON.stringify(health));

  // credential health self-report: ask Facebook how long the Meta token has left
  // (debug_token introspection) and write it to connector_status for the dashboard.
  try {
    const statusRows = [];
    if (META_ACCESS_TOKEN) {
      const r = await fetchT(`https://graph.facebook.com/v21.0/debug_token?input_token=${META_ACCESS_TOKEN}&access_token=${META_ACCESS_TOKEN}`);
      const d = (await r.json())?.data || {};
      // effective expiry = the sooner of session expiry and data-access expiry
      // (expires_at can be 0 = "session never expires", but data_access_expires_at
      // still cuts off reads ~90 days out — that's the clock that matters).
      const clocks = [d.expires_at, d.data_access_expires_at].filter((x) => x > 0);
      statusRows.push({
        provider: "meta",
        status: d.is_valid ? "ok" : "expired",
        expires_at: clocks.length ? new Date(Math.min(...clocks) * 1000).toISOString() : null,
        detail: d.is_valid
          ? `user token${d.expires_at === 0 ? " (session non-expiring; limit is data access)" : ""} · scopes: ${(d.scopes || []).join(", ")}`
          : (d.error?.message || "token invalid"),
      });
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
    const gaps = await sb("rpc/data_gaps", { method: "POST", body: JSON.stringify({ p_days: 14 }) });
    const healable = gaps.filter(g => g.source !== "google_ads");
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
  } catch (e) { console.warn("sentinel failed:", e.message); }

  // Shared alert helper (deduped DB-side; never throws — alerting must not break a sync).
  const alertFn = async (kind, subject, body, dedupeKey, hours = 24) => {
    try {
      await sb("rpc/send_alert", { method: "POST", body: JSON.stringify({
        p_kind: kind, p_subject: subject, p_body: body, p_dedupe_key: dedupeKey, p_dedupe_hours: hours }) });
    } catch (e) { console.warn(`alert(${kind}) failed:`, e.message); }
  };

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
        const r = await fetchT(`${META_API}/${ext}?fields=name,access_token&access_token=${META_ACCESS_TOKEN}`, {}, 15000);
        const d = await r.json();
        if (d.error) return [false, d.error.message.slice(0, 160)];
        return d.access_token ? [true, d.name || "page"] : [false, `${d.name || "page"}: no page token (needs Analyze role)`];
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
      if (src === "google_ads") {
        // push-based: "reachable" = the Ads Script has posted for this account recently
        const rows = await sb(`metrics_daily?select=metric_date&source=eq.google_ads`
          + `&account_ext_id=ilike.*${ext.replace(/\D/g, "").slice(-4)}*&order=metric_date.desc&limit=1`);
        const last = rows?.[0]?.metric_date;
        const fresh = last && (Date.now() - new Date(last)) < 5 * 864e5;
        return [!!fresh, last ? `last script post ${last}` : "no data ever posted"];
      }
      return [true, "no probe for this source"];
    } catch (e) { return [false, e.message.slice(0, 160)]; }
  }

  try {
    const allMappings = await sb(
      "client_sources?select=source,external_id,params,active,clients!inner(slug,status)&clients.status=eq.active");
    const verdicts = await mapLimit(allMappings, 5, async (s) => {
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
      await alertFn("connection", `🔌 ${b.slug} / ${b.source} connection BROKEN`,
        `The ${b.source} connection for ${b.slug} (${b.ext}) stopped working.\n\nProvider says: ${b.detail}\n\n`
        + `It was reachable on the previous probe, so this is new — likely a permission change or revoked access.`,
        `broken:${b.slug}:${b.source}:${b.ext}`, 24);
    }
    if (opportunities.length) {
      await alertFn("connection", `🔎 ${opportunities.length} parked account${opportunities.length === 1 ? " is" : "s are"} now reachable`,
        `These mappings are marked INACTIVE but the smoke test can reach them — they may be parked on a stale reason `
        + `(this is how Every Child TN stayed dark for 7 weeks):\n\n`
        + opportunities.map(o => `• ${o.slug} / ${o.source} ${o.ext} — ${o.detail}`).join("\n")
        + `\n\nIf one should be reporting, activate it in client_sources and backfill.`,
        `opportunity:${opportunities.map(o => `${o.slug}:${o.ext}`).sort().join(",")}`, 72);
    }
    for (const r of recovered) {
      await alertFn("connection", `✅ ${r.slug} / ${r.source} connection recovered`,
        `${r.slug} / ${r.source} (${r.ext}) is reachable again: ${r.detail}`,
        `recovered:${r.slug}:${r.source}:${r.ext}`, 24);
    }
  } catch (e) { console.warn("connection probe failed:", e.message); }

  // ---- error-flow alerts: email on the failures that actually matter ----
  // Deduped in the DB (same alert once per window) so an outage pages us daily,
  // not every run. Alerting never throws — a broken alert must not break a sync.
  try {
    // 1) a source where every pull failed
    for (const src of deadSources) {
      await alertFn("sync_failure", `⚠ ${src} sync failed — 0 of ${health[src].fail} pulls succeeded`,
        `Every ${src} pull failed on the ${START}..${END} run.\n\n`
        + `Source health: ${JSON.stringify(health)}\n`
        + `Rows ingested: ${JSON.stringify(tally)}\n\n`
        + `Most common cause: an expired credential. Check /pipeline → Credentials.`,
        `sync_failure:${src}`, 12);
    }
    // 2) partial failures worth knowing about (some accounts blocked, not all)
    for (const [src, h] of Object.entries(health)) {
      if (h.fail > 0 && h.ok > 0) {
        await alertFn("sync_failure", `${src}: ${h.fail} of ${h.ok + h.fail} pulls failed`,
          `Partial ${src} failure on ${START}..${END} — ${h.ok} ok, ${h.fail} failed.\n`
          + `Usually per-account permissions rather than a dead credential.`,
          `partial:${src}:${h.fail}`, 48);
      }
    }
    // 3) credential expiry warnings (read what we just wrote to connector_status)
    const creds = await sb("connector_status?select=provider,status,expires_at");
    for (const c of (creds || [])) {
      if (c.status === "expired") {
        await alertFn("credential", `🔑 ${c.provider} credential EXPIRED`,
          `The ${c.provider} credential is rejected by the provider. Pulls for it are failing now.\n`
          + `Fix: mint a new token and update the GitHub secret, then re-run.`,
          `cred_expired:${c.provider}`, 12);
      } else if (c.expires_at) {
        const days = Math.round((new Date(c.expires_at) - Date.now()) / 864e5);
        if (days <= 14 && days > 0) {
          await alertFn("credential", `🔑 ${c.provider} credential expires in ${days} day${days === 1 ? "" : "s"}`,
            `${c.provider} expires ${String(c.expires_at).slice(0, 10)}.\n`
            + `Rotate before then to avoid a silent data gap.`,
            `cred_expiring:${c.provider}:${days > 7 ? "14d" : days > 3 ? "7d" : "3d"}`, 72);
        }
      }
    }
    // 4) integrity sentinel verdict (only when it isn't clean)
    const lastCheck = await sb("integrity_checks?select=status,gaps_found,summary&order=checked_at.desc&limit=1");
    const ic = lastCheck?.[0];
    if (ic && ic.status !== "ok") {
      await alertFn("integrity", `📉 Data integrity: ${ic.status}`,
        `The nightly integrity check reported "${ic.status}".\n\n`
        + `Gap-days found: ${ic.gaps_found}\n`
        + `Details: ${JSON.stringify(ic.summary)}\n\n`
        + `Google Ads gaps need the MCC backfill script (push-only source).`,
        `integrity:${ic.status}:${JSON.stringify(ic.summary?.google_ads_gaps || [])}`, 24);
    }
  } catch (e) { console.warn("alerting block failed:", e.message); }

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
