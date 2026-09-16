# Deksia Reporting — Handoff (2026-09-16)

Written for whoever picks this up next, human or model. Read this before touching anything.
Release at handoff: **v2.0.0** (`818911f`). Repo: `Highamm-coder/deksia-v2-reporting`.

## 1. What this is

A client-performance reporting platform for Deksia (marketing agency, ~26 active clients).
One headless daily pull from every vendor API into Supabase, a Next.js console on Vercel,
goals/objectives/custom formulas on top. Owner: Matt (matthew@deksia.com). Account managers
read client pages; only admins see the admin side.

**Three standing rules from Matt. Treat them as law.**
1. *"The cardinal sin of this platform will be not knowing exactly where data has come from."*
   Every row is stamped with writer + batch; provenance tables/views are never hidden.
2. *"I don't want any manipulation of the data — present exactly as it is in platform."*
   No zero-fill, no derived rates presented as platform numbers, rates never summed.
   The only aggregation allowed is summing additive counts to a coarser key that the
   platform itself would report (documented where it happens).
3. **Credentials are installed by Matt, never handled by the assistant.** You never see a
   token value. You tell Matt the exact `gh secret set …` command; he runs it.

Also: *"Do not call the Agent tool unless requested"*; *"Do not use workflows/deep-research
unless requested"*; core data over breadth (*"really just need core data"*); no new
integrations beyond Search Console and YouTube for now.

## 2. Architecture in one screen

```
vendor APIs ──► orchestrator/run.mjs (GitHub Actions, daily 11:00 UTC) ──► ingest-metrics edge fn
  Meta Graph, Pages, GA4 Data API,          │ probes every mapped account        │  (bearer = Vault ingest_token)
  CallRail v3, Google Ads API,              │ discovery (what each cred can see) ▼
  Search Console (built, awaiting scope)    │ integrity sentinel + one digest   ingest_rows() RPC
                                            │                                    ▼
.github/workflows/backfill.yml (every 2 h) ─┘ claims backfill_chunks       fact_daily × series × metric_definitions × ingest_batches
                                                                             ▼ (metrics_daily = compatibility VIEW)
                                          pg_cron: rollups :15 hourly · retention 09:40 · goal tracker 10:00
                                                                             ▼
                                          Next.js 14 console (web/) — Vercel — monochrome, Wise-style
```

Supabase project `ykxauddrsnuwkvimkdhw` (**free plan** — 500 MB cap, no backups; DB ≈ 280 MB).
Secrets live in GitHub Actions only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_TOKEN`,
`GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` (9290985791), `META_ACCESS_TOKEN`, `CALLRAIL_API_KEY`.
Vercel has `GITHUB_DISPATCH_TOKEN` (console buttons dispatch workflows) — working since 2026-09-15.

## 3. Data model (read `supabase/migrations/0039*`–`0058*` markers)

- `fact_daily(series_id, metric_date, metric_id, value, batch_id, extra)` — PK order serves upsert and date-range scans.
- `series(client_id, source, account_ext_id, entity, qualifier, grain)` — interned "who/where"; `grain` ∈ count | rate | breakout, derived by `series_grain(qualifier)`.
- `metric_definitions(source, metric_name, metric_id, unit, agg, direction_default, provenance)` — self-describing via `ensure_metric_defs()`; `agg` decides sum vs avg. **Never sum a rate.**
- `ingest_batches(writer, ingested_at, source)` — provenance per POST.
- `source_days(source, metric_date)` — day registry for the gap sentinel.
- `metrics_daily` — VIEW with the legacy 11 columns; READ-ONLY. Writes go through `ingest_rows()` (service role) or `upsert_manual_metric()` (console).
- **Grain contract** (qualifier text): `''` account total · `<ad group>` / `adset › ad` counts · `rate` platform-computed rates · prefixed breakouts `ad: ag: term: kw: dev: net: age: gender: brk:` are NON-ADDITIVE and excluded from totals by `is_breakout()` / `series.grain`. `ad:` and `ag:` are kept long-term; the rest follow the 90-day rule.
- **Canonical Google Ads account id = digits** (`ingest_rows` normalises). Everything joins on digit-normalised ids.
- Rollups in schema `private` (`mv_metrics_monthly_dim` excludes split grains; `mv_client_provenance` hash-agg only; `mv_pipeline_health` lag-aware). `refresh_rollups()` writes `rollup_status`.
- Retention `prune_metrics()`: all grains current + previous calendar year; splits 90 days. Deletes one month per statement. After big deletes: `vacuum full <table>` in its own call (free-tier cap counts bloat).

## 4. Sources (registry = `source_methods`, view `v_sources`)

| source | how | notes |
|---|---|---|
| meta | Graph API, token = social@deksia user token, data access expires **2026-11-03** | standard depth = `META_STANDARD_ACTIONS`; full = everything. Engelsma is `full` (custom pixel event is their conversion). |
| pages | Graph API Page Insights | 18 pages |
| ga4 | Data API runReport, day × channel × source/medium | users/new_users excluded from sums |
| callrail | v3 REST per company | `params.account_id` required |
| google_ads | **API** (Explorer access = read-only + daily op cap). MCC accounts via `login-customer-id` = MCC; the 12 outside-MCC accounts as themselves (`selfLogin`) | quota: ≤3 backfill chunks/day; 429 "Retry in N seconds" → deferral; daily run skips a parked source, sentinel heals. Video metrics not served on `campaign` in v23. |
| search_console | **built, inactive** — needs `webmasters.readonly` on the token | property id = `sc-domain:…` or `https://…/`; 3-day lag; ctr/position are rates |
| youtube | registered, not built | Analytics API where channel manager access exists, Data API public snapshot otherwise |
| instagram, gbp, linkedin, tiktok_ads, pinterest_ads, nextdoor_ads | placeholders only | Matt: no more connections for now |

## 5. Console map (web/app)

- `/` Scoreboard (goals — **wiped 2026-09-04 by Matt to redo by hand**; copies in `private.goals_wiped_20260904`).
- `/clients`, `/clients/[slug]` (month picker, objectives, performance, campaigns drill, events, lead sources), `/clients/[slug]/settings` (sources + plain-language status, provenance, metric depth, computed formulas, re-pull → backfill job), `/clients/[slug]/goals`.
- `/data` Data health (admin): ring = access (probes) + fill = freshness (rollup); header answers "is it fine" in one line; refused list; integrity; **Backfills** (the only way to re-pull). `/pipeline` redirects here.
- `/connections` (admin): credentials as one-line summaries; discovered-but-unmapped grid (bulk Map / Ignore); mapped grid (filters, bulk, per-row probe/edit/re-pull); attach-by-ID with digit-normalise → discovery warn-and-confirm → immediate probe.
- `/admin`: users, admins, bug reports, new client. `/admin/onboarding` redirects here.
- `web/app/_components/DataGrid.js` — THE list pattern (toolbar, filters, sort, column picker, selection + bulk, kebab). Column configs with render fns must live in a `"use client"` file per page (see `connections/Grids.js`).
- `web/lib/statusSentence.js` — member-facing wait-vs-report sentence over `v_client_source_status`.
- Members never see rotation text, scopes, secrets, re-pull, Fix →, or the token warning.

Dev: `.claude/launch.json` → `console` (port 3000). **Never `next build` while `next dev` runs**: kill dev → build → `rm -rf .next` → restart.

## 6. Operations & gotchas (hard-won)

- Meta app rate limit: many manual runs in a day trip it; a throttled `debug_token` must not be read as "expired" (fixed) — probes report "rate-limited, not tested".
- Google Ads Explorer quota resets ~15:00 UTC; a day of backfilling starves the 07:00 ET run — the run now skips a parked source and the sentinel heals the day after.
- `connection_probes` keeps rows for ids that are no longer mapped; views/lists only count probes matching a CURRENT mapping (0058). Orphans purged then; keep it that way.
- `connector_status.status` for Google/CallRail only updates on real reads (not probe-only); Meta only on Facebook's explicit verdict.
- Free tier: big sorts spill temp and fail with `53100`; use hash-friendly queries, `set work_mem='96MB'` for refreshes, never `array_agg(DISTINCT …)` over the fact table.
- Matviews can't be `CREATE OR REPLACE`d — recreating cascades to dependent views; all view DDL is in migrations 0041/0046/0047/0050/0052. Recreated views must get `security_invoker = true` and grants back (0048 — the advisor flagged 18 definer views once).
- `goal_progress` is append-only (trigger). To wipe, disable ONLY the non-internal trigger by name.
- Alerts: `send_alert()` via Resend; one digest per run. Resend domain `deksia.com` verification was pending; alerts route via social@deksia.
- Memory for the previous assistant instance: `~/.claude/projects/-Users-deksia-deksia-v2-reporting/memory/daily-sync-ops.md` (same content as this doc, more granular).

## 7. State at handoff & open items

**Working:** daily pull for all 5 live sources (114 mappings, 0 unreachable); backfill runner; retention; alerts; console on v2.0.0.

**In flight:** Matt is minting the Google refresh token with 7 scopes (analytics, sheets, adwords, **webmasters.readonly, youtube.readonly, yt-analytics.readonly, openid+email**) as social@deksia.com. When `GOOGLE_OAUTH_REFRESH_TOKEN` is set:
1. dispatch a probe-only run (`gh workflow run orchestrate.yml -f probe_only=true`) — `connector_status.scopes` should list 7 and `connector_discovery` should list Search Console sites;
2. `update source_methods set active=true where source='search_console'`;
3. map properties to clients on `/connections` (bulk Map), then queue a backfill job Jan 1 → yesterday for `search_console` (16-month history available);
4. enable the **Google Analytics Admin API** in the Cloud project so GA4 discovery lists properties.

**Then:** YouTube puller (Analytics API + public fallback), same shape as Search Console.

**Housekeeping:** Supabase Pro ($25/mo) for backups is recommended, not required for space. Leaked-password protection toggle in Supabase Auth. `private.goals_wiped_20260904*` and `private.goal_progress_wiped_*` can be dropped after Matt rebuilds goals. Remaining lists to move onto DataGrid: clients, refused list, backfill jobs, admin tables, client-page tables.

**Recent incident worth knowing:** Knight Watch (slug `KWI`) onboarding — GA4 id typed one digit off twice, then access granted to the wrong Google user. Correct property id **314248905** (account 225180890). This is why attach-by-ID normalises, warns against discovery, and probes immediately.
