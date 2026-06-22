# Daily Platform Sync — Runbook (scheduled Claude routine)

The canonical daily procedure. A scheduled Claude run follows these steps using the
**session connectors** (Composio MCP for GA4/Sheets/Pages, Meta Ads MCP, CallRail REST,
Supabase MCP). Everything is idempotent — safe to re-run any day.

**Why a Claude routine (not GitHub Actions):** the GA4/Sheets/Meta connections are
Claude-managed (no standalone Composio API key authenticates them headlessly — confirmed
401 via the Composio SDK). So the runner lives where those connectors exist: a scheduled
Claude run. `orchestrator/run.mjs` is kept as the *direct-creds CI alternative* (Google
service account + Meta token) if a no-Claude pipeline is ever needed.

- **Project:** Supabase `ykxauddrsnuwkvimkdhw`. **Timezone:** America/New_York.
- **Window:** counts (Meta/CallRail/GA4) = yesterday daily; GA4 also gives day×channel.
- **Idempotent key:** `metrics_daily (client_id, source, metric_name, metric_date, account_ext_id, entity, qualifier)`.

## Steps

1. **Read active sources** — `select source, external_id, params, clients!inner(slug) from client_sources where active and clients.status='active'`.

2. **GA4** (Composio `GOOGLE_ANALYTICS_RUN_REPORT`, connection `google_analytics_duhat-aspace`):
   per `ga4` source, dimensions `[date, sessionDefaultChannelGroup]`, metrics
   `sessions,totalUsers,newUsers,engagedSessions,keyEvents`. Upsert one row per day×channel
   (`qualifier=channelGroup`, `account_ext_id=property`, `entity=brand`) **plus** unsegmented
   daily totals (`qualifier=''`). Metric names: sessions, users, new_users, engaged_sessions, key_events.

3. **Meta** (Meta Ads MCP `ads_get_ad_entities`, `level:account`, `time_increment:1`):
   per **active+confirmed** `meta` source, fields impressions/clicks/ctr/actions:link_click/
   lead/cpc/amount_spent. Run `to_number` (strip `$ , % USD nbsp`; "Not available"→null).
   Upsert per day. (Confirmed accounts: Moda=567942467523634, Oleandri=860604639208429,
   KTU=851287220971008; others single.)

4. **CallRail** (REST, `CALLRAIL_API_KEY`): per `callrail` company, paginate yesterday's
   `calls.json` + `form_submissions.json` with `fields=...,source`; bucket by source →
   `calls`/`forms`/`mqls` rows with `qualifier=source`, plus loose totals (`qualifier=''`).

5. **Google Ads** (Composio `GOOGLESHEETS_BATCH_GET`, connection `googlesheets_divot-reroll`):
   read Ledger `1cEIfUfd_AFd4r82qt9p9imuo7oaqcJqwgZXAGXRSzhU` tabs `Campaigns` + `Conversions`,
   keep yesterday's rows, dedup latest per `(cid,campaign,date)`, resolve client by CID against
   `client_sources`, upsert campaign metrics (`account_ext_id=cid, entity=campaign`) +
   `conversion_action` rows (`qualifier=action`).

6. **Pages** (Composio `FACEBOOK_GET_PAGE_INSIGHTS`) — only pages with an "Analyze" role
   return data; map `page_daily_follows_unique→followers, page_media_view→reach,
   page_post_engagements→engagement, page_video_views→video_views`. Empty `{}` = skip.

7. **Tracker + health** — `select public.run_goal_tracker();` then upsert `connector_health`
   per source (flowing/degraded/idle) and append a `run_log` row (period, clients, rows, sources).

## Verify after a run
- `select source, count(*), max(metric_date) from metrics_daily group by source;` — yesterday present.
- Re-run once → row counts stable (idempotent).
- Dashboard (`dashboard.html`) fresh-cell count holds/rises; `goal_progress` has a new `as_of_date`.

## Connector-availability check (first scheduled fire)
Confirm the scheduled run can actually reach Composio + Meta Ads MCP + CallRail. If a cloud
routine lacks them, run the routine on the Mac where the connectors/CallRail server live, or
switch to the direct-creds `run.mjs` path.
