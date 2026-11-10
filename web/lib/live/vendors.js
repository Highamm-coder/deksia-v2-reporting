// PROTOTYPE — fetch-on-demand. Reads one mapping's numbers for one date range straight from the
// vendor API, on the server, and returns them. It writes NOTHING: not fact_daily, not any
// pipeline table. The nightly pipeline (orchestrator/run.mjs) is untouched.
//
// The request shapes are the orchestrator's (getGoogleToken, gadsQuery, pullGA4, pullCallRail,
// gscQuery, metaInsights). The one deliberate difference is the grain asked for: the pipeline
// asks per DAY and the console sums / averages days into a month; here each platform is asked
// for the RANGE in one piece, so every figure — rates and de-duplicated counts included — is the
// platform's own number for that range, not something this code derived.
//
// Secrets come from process.env only (same names as the GitHub Actions secrets). They are never
// logged and never returned: errors carry the vendor's message, not the request.
import "server-only";

const env = (k) => (process.env[k] || "").trim();

// What each source needs. A missing name is reported on the page so Matt knows what to set.
export const REQUIRED_ENV = {
  google_ads: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_LOGIN_CUSTOMER_ID"],
  ga4: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN"],
  search_console: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN"],
  callrail: ["CALLRAIL_API_KEY"],
  meta: ["META_ACCESS_TOKEN"],
};
export const missingEnv = (source) => (REQUIRED_ENV[source] || []).filter((k) => !env(k));
export const LIVE_SOURCES = Object.keys(REQUIRED_ENV);

async function fetchT(url, opts = {}, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error(`timeout after ${ms}ms`)), ms);
  // cache: "no-store" — Next must not put vendor responses in its own fetch cache; the only
  // cache is the explicit, short-TTL one in live/index.js.
  try { return await fetch(url, { ...opts, signal: ctl.signal, cache: "no-store" }); }
  finally { clearTimeout(t); }
}

// ---- Google OAuth access token from the refresh token (cached in this server instance) ----
let _googleToken = null; // { token, exp }
let _googleTokenInflight = null;
async function getGoogleToken() {
  if (_googleToken && _googleToken.exp > Date.now() / 1000 + 60) return _googleToken.token;
  if (_googleTokenInflight) return _googleTokenInflight;
  _googleTokenInflight = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const res = await fetchT("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
        client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
        refresh_token: env("GOOGLE_OAUTH_REFRESH_TOKEN"),
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.access_token) throw new Error(`google token: ${res.status} ${out.error || ""} ${out.error_description || ""}`.trim());
    _googleToken = { token: out.access_token, exp: now + (out.expires_in || 3600) };
    return _googleToken.token;
  })();
  try { return await _googleTokenInflight; } finally { _googleTokenInflight = null; }
}

const gNum = (v) => (v == null ? null : Number(v));
const gMicros = (v) => (v == null ? null : Number(v) / 1e6);
const gPct = (v) => (v == null ? null : Number(v) * 100);
const m = (value, unit, kind = "count") => ({ value: value == null || Number.isNaN(Number(value)) ? null : Number(value), unit, kind });

// ---- Google Ads: one GAQL searchStream = ONE operation of the Explorer daily cap ----
const GADS_VERSIONS = (process.env.GOOGLE_ADS_API_VERSION || "v23,v22,v21,v20").split(",");
let _gadsVersion = null;
async function gadsQuery(cid, gaql, ops) {
  const tok = await getGoogleToken();
  const id = String(cid).replace(/\D/g, "");
  const mcc = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/\D/g, "");
  const logins = [mcc, id];                      // MCC first, then the account as its own login (outside-MCC accounts)
  const versions = _gadsVersion ? [_gadsVersion] : GADS_VERSIONS;
  let lastErr = null;
  for (const login of logins) {
    for (const v of versions) {
      const r = await fetchT(`https://googleads.googleapis.com/${v}/customers/${id}/googleAds:searchStream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok}`, "developer-token": env("GOOGLE_ADS_DEVELOPER_TOKEN"),
          "login-customer-id": login, "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gaql }),
      }, 60000);
      const text = await r.text();
      if (r.status === 404 && !_gadsVersion) { lastErr = `${v} not served`; continue; }   // version probe, not a query
      ops.n += 1;                                  // counted even when refused, to stay conservative
      let body; try { body = JSON.parse(text); } catch { body = text; }
      if (!r.ok) {
        const err = Array.isArray(body) ? body[0]?.error : body?.error;
        const detail = err?.details?.[0]?.errors?.[0]?.message || err?.message || String(text).slice(0, 200);
        if (r.status === 403 && /permission to access customer/i.test(detail) && login !== id) { lastErr = detail; break; }
        throw new Error(`google ads ${id}: ${r.status} ${detail}${login === id ? " (as own login customer)" : ""}`);
      }
      _gadsVersion = v;
      const chunks = Array.isArray(body) ? body : [body];
      return chunks.flatMap((c) => c.results || []);
    }
  }
  throw new Error(`google ads ${id}: 403 ${lastErr || "no API version answered"}`);
}

// 2 operations per uncached view:
//   1. the ACCOUNT's totals and rates for the range (FROM customer) — Google's own figures
//   2. the same per campaign (FROM campaign) — the campaign table
async function liveGoogleAds({ externalId, start, end }) {
  const ops = { n: 0 };
  const cols = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, "
    + "metrics.all_conversions, metrics.view_through_conversions, metrics.ctr, metrics.average_cpc, metrics.average_cpm, "
    + "metrics.cost_per_conversion, metrics.conversions_from_interactions_rate";
  const where = `WHERE segments.date BETWEEN '${start}' AND '${end}'`;
  const [acct, camps] = await Promise.all([
    gadsQuery(externalId, `SELECT ${cols} FROM customer ${where}`, ops),
    gadsQuery(externalId, `SELECT campaign.name, campaign.advertising_channel_type, ${cols} FROM campaign ${where} AND metrics.impressions > 0`, ops),
  ]);
  const shape = (x = {}) => ({
    impressions: m(gNum(x.impressions), "int"),
    clicks: m(gNum(x.clicks), "int"),
    spend: m(gMicros(x.costMicros), "usd"),
    conversions: m(gNum(x.conversions), "int"),
    conversions_value: m(gNum(x.conversionsValue), "usd"),
    all_conversions: m(gNum(x.allConversions), "int"),
    view_through_conversions: m(gNum(x.viewThroughConversions), "int"),
    ctr: m(gPct(x.ctr), "pct", "rate"),
    cpc: m(gMicros(x.averageCpc), "usd", "rate"),
    cpm: m(gMicros(x.averageCpm), "usd", "rate"),
    cost_per_conversion: m(gMicros(x.costPerConversion), "usd", "rate"),
    conversion_rate: m(gPct(x.conversionsFromInteractionsRate), "pct", "rate"),
  });
  // No row at all = the account reported nothing for the range. Left empty, not zero-filled.
  const metrics = acct.length ? shape(acct[0].metrics) : {};
  const breakdown = camps
    .map((r) => ({ name: r.campaign?.name || "", type: String(r.campaign?.advertisingChannelType || "").toLowerCase(), metrics: shape(r.metrics) }))
    .sort((a, b) => (b.metrics.spend.value || 0) - (a.metrics.spend.value || 0));
  return { metrics, breakdown, breakdownLabel: "Campaign", calls: ops.n, quotaOps: ops.n,
    note: "Account totals and rates as Google Ads reports them for the whole range (FROM customer). Each searchStream is 1 operation of the 2,880/day Explorer cap." };
}

// ---- GA4: one runReport, no dimensions = the property's own totals for the range ----
const GA4_METRICS = [["sessions", "sessions"], ["users", "totalUsers"], ["new_users", "newUsers"],
  ["engaged_sessions", "engagedSessions"], ["key_events", "keyEvents"]];
async function liveGA4({ externalId, start, end }) {
  const token = await getGoogleToken();
  const res = await fetchT(`https://analyticsdata.googleapis.com/v1beta/properties/${externalId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: start, endDate: end }],
      metrics: GA4_METRICS.map(([, api]) => ({ name: api })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ga4 ${externalId}: ${res.status} ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  const row = (data.rows || [])[0];
  const metrics = {};
  if (row) GA4_METRICS.forEach(([name], i) => { metrics[name] = m(row.metricValues[i]?.value, "int", name === "users" || name === "new_users" ? "unique" : "count"); });
  return { metrics, calls: 1, quotaOps: 0,
    note: "Property totals as GA4 reports them for the whole range. Users and new users are de-duplicated by GA4 across the range, which daily rows cannot be summed to." };
}

// ---- Search Console: one query, no dimensions = the property's totals for the range ----
async function liveSearchConsole({ externalId, start, end }) {
  const token = await getGoogleToken();
  const site = String(externalId).trim();
  const res = await fetchT(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: start, endDate: end }),
  }, 60000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`search_console ${site}: ${res.status} ${data.error?.message || JSON.stringify(data).slice(0, 160)}`);
  const r = (data.rows || [])[0];
  const metrics = r ? {
    clicks: m(r.clicks, "int"), impressions: m(r.impressions, "int"),
    ctr: m(r.ctr * 100, "pct", "rate"), position: m(r.position, "pos", "rate"),
  } : {};
  return { metrics, calls: 1, quotaOps: 0,
    note: "Property totals as Search Console reports them for the whole range. CTR and position are Search Console's figures for the range. Search Console only serves the last 16 months and runs about 3 days behind." };
}

// ---- CallRail: every call and form in the range, counted; qualified = lead_status 'good_lead' ----
// Same request and same counting as pullCallRail. CallRail has no "total for the range" figure
// with lead status, so this is a count of the records it returns, as the pipeline's is.
async function liveCallRail({ externalId, params, start, end }) {
  const account = params?.account_id;
  if (!account) throw new Error("callrail: mapping has no params.account_id");
  const hdr = { Authorization: `Token token=${env("CALLRAIL_API_KEY")}` };
  const base = `https://api.callrail.com/v3/a/${account}`;
  let calls = 0;
  const bySource = {};
  const fetchAll = async (endpoint, dateField) => {
    const tot = { n: 0, q: 0 };
    for (let page = 1; page <= 200; page++) {
      const q = `company_id=${externalId}&start_date=${start}&end_date=${end}&per_page=250&page=${page}&fields=${dateField},source,lead_status`;
      calls += 1;
      const r0 = await fetchT(`${base}/${endpoint}.json?${q}`, { headers: hdr });
      const d = await r0.json().catch(() => ({}));
      if (!r0.ok || d.error) throw new Error(`callrail ${endpoint} ${externalId}: ${r0.status} ${JSON.stringify(d.error || d).slice(0, 150)}`);
      const recs = d[endpoint === "calls" ? "calls" : "form_submissions"] || [];
      for (const r of recs) {
        if (!(r[dateField] || "").slice(0, 10)) continue;
        const s = r.source || "Unknown";
        const cell = bySource[s] || (bySource[s] = { calls: 0, forms: 0, q: 0 });
        cell[endpoint === "calls" ? "calls" : "forms"] += 1;
        tot.n += 1;
        if (r.lead_status === "good_lead") { tot.q += 1; cell.q += 1; }
      }
      if (page >= (d.total_pages || 1) || !recs.length) break;
    }
    return tot;
  };
  const [c, f] = await Promise.all([fetchAll("calls", "start_time"), fetchAll("form_submissions", "submitted_at")]);
  const metrics = {
    mqls: m(c.n + f.n, "int"),
    qualified_leads: m(c.q + f.q, "int"),
  };
  // The pipeline writes a calls / forms row only where there is at least one; mirror that.
  if (c.n) metrics.calls = m(c.n, "int");
  if (f.n) metrics.forms = m(f.n, "int");
  const breakdown = Object.entries(bySource)
    .map(([name, v]) => ({ name, metrics: { mqls: m(v.calls + v.forms, "int"), qualified_leads: m(v.q, "int"),
      ...(v.calls ? { calls: m(v.calls, "int") } : {}), ...(v.forms ? { forms: m(v.forms, "int") } : {}) } }))
    .sort((a, b) => b.metrics.mqls.value - a.metrics.mqls.value);
  return { metrics, breakdown, breakdownLabel: "Lead source", calls, quotaOps: 0,
    note: "Counted from the calls and forms CallRail returns for the range. Qualified = lead_status 'good_lead' as it stands right now, so a lead marked today counts today." };
}

// ---- Meta: one account-level insights call for the range, no daily increment ----
const META_API = "https://graph.facebook.com/v21.0";
async function liveMeta({ externalId, start, end }) {
  const acct = String(externalId).replace(/^act_/, "");
  const url = `${META_API}/act_${acct}/insights?level=account`
    + `&time_range=${encodeURIComponent(JSON.stringify({ since: start, until: end }))}`
    + "&fields=impressions,clicks,spend,inline_link_clicks,reach,frequency,ctr,cpc,cpm,actions,cost_per_action_type&limit=500";
  // Token in the Authorization header, not the query string, so it can never appear in a URL.
  const d = await fetchT(url, { headers: { Authorization: `Bearer ${env("META_ACCESS_TOKEN")}` } }).then((r) => r.json());
  if (d.error) throw new Error(`meta ${acct}: ${d.error.message}`);
  const r = (d.data || [])[0];
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const metrics = {};
  if (r) {
    Object.assign(metrics, {
      impressions: m(num(r.impressions), "int"), clicks: m(num(r.clicks), "int"), spend: m(num(r.spend), "usd"),
      link_clicks: m(num(r.inline_link_clicks), "int"),
      reach: m(num(r.reach), "int", "unique"), frequency: m(num(r.frequency), "ratio", "rate"),
      ctr: m(num(r.ctr), "pct", "rate"), cpc: m(num(r.cpc), "usd", "rate"), cpm: m(num(r.cpm), "usd", "rate"),
    });
    const lead = (r.actions || []).find((a) => a.action_type === "lead");
    if (lead) metrics.leads = m(num(lead.value), "int");
    const cpl = (r.cost_per_action_type || []).find((a) => a.action_type === "lead");
    if (cpl) metrics.cost_per_lead = m(num(cpl.value), "usd", "rate");
  }
  return { metrics, calls: 1, quotaOps: 0,
    note: "Account totals as Meta reports them for the whole range. Reach and frequency are de-duplicated by Meta across the range, which daily rows cannot be summed to." };
}

const FETCHERS = { google_ads: liveGoogleAds, ga4: liveGA4, search_console: liveSearchConsole, callrail: liveCallRail, meta: liveMeta };

// One mapping, one range. Throws on failure (so a failure is never cached).
export async function fetchLive({ source, externalId, params, start, end }) {
  const fn = FETCHERS[source];
  if (!fn) throw new Error(`no live fetcher for ${source}`);
  const t0 = performance.now();
  const out = await fn({ externalId, params: params || {}, start, end });
  return { ...out, source, externalId, start, end, ms: Math.round(performance.now() - t0), fetchedAt: new Date().toISOString() };
}
