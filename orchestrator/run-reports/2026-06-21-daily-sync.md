# Daily Platform Sync — Run Report

**Run date:** 2026-06-22 (executed by scheduled Claude routine)
**Data window:** 2026-06-21 (yesterday, America/New_York) — single day, daily grain
**Supabase project:** `ykxauddrsnuwkvimkdhw`
**Runbook followed:** `orchestrator/daily-run.md`
**Outcome:** ✅ Completed. 1,002 rows upserted to `public.metrics_daily`. 3 of 5 sources fully healthy; 2 flagged (see below).

---

## Results by source

| Source | Rows | Status | Notes |
|---|---:|---|---|
| GA4 | 880 | ✅ flowing | 29/30 properties returned data. Oleandri (`522006625`) had 0 sessions for the day. Day×channel grain. |
| Meta | 84 | ✅ flowing | 13/15 accounts. Hatton Power (`1507263374306192`) & RBMitchell (`442780278451816`) returned `[]` (no active spend). |
| CallRail | 18 | ✅ flowing | 12 companies. 0 calls, 21 forms (Saturday). Pulled via **v3** REST. |
| Pages | 20 | ⚠️ degraded | Only **5/18** pages accessible to the FB connection. |
| Google Ads | **0** | ⚠️ degraded | Ledger sheet has **no 2026-06-21 rows** (stale at 2026-06-18). Not zero-filled. |

`run_goal_tracker()` → `(31 goals processed, 0 new snapshots)`. 0 new because today's (`2026-06-22`) `goal_progress` snapshot already existed from the in-DB cron; `goals.current_value` *was* refreshed with the new data via the function's UPDATE. `connector_health` upserted per source; `run_log` row appended (`period='2026-06-21'`, `rows_written=1002`).

---

## 🔴 Action items (ranked)

### 1. Goal double-count: storing per-segment **and** loose totals corrupts every `sum` goal
This is the most important finding. `run_goal_tracker`, `metrics_weekly`, and `metrics_monthly` all aggregate across the full row grain **with no qualifier filter**:

```sql
-- run_goal_tracker (supabase/migrations/0003_platform_schema.sql:196-201)
select ... sum(value) ... from public.metrics_daily
 where client_id=g.client_id and source=g.source and metric_name=g.metric_name
   and metric_date between g.start_date and least(p_as_of, g.due_date);
```

But `run.mjs` (and the runbook step 2/4) write **both** per-segment rows (GA4 per channel `qualifier=channel`; CallRail per source `qualifier=source`) **and** an unsegmented `qualifier=''` total for the same `metric_name`. Since the loose total equals the sum of the segments, the tracker sums them and gets **2× the real value** for every active `sum`-metric goal — confirmed affected: `callrail.mqls/forms/qualified_leads`, `ga4.sessions`, `meta.*`, `pages.followers/reach/video_views/engagement`.

**What this run did:** stored **per-segment rows only** and **skipped the loose `qualifier=''` totals**, so the tracker sums the segments to the correct client total. This deviates from the literal runbook text.

**Decide and codify one of:**
- **(A)** Drop the loose-total writes from `run.mjs` (`pullGA4` lines ~161-165, `pullCallRail` lines ~130-134) — match what this run did. Simplest.
- **(B)** Keep both grains but make every consumer filter `qualifier=''` (and `entity=''`, `account_ext_id=''`) for the headline number — change `run_goal_tracker`, `metrics_weekly`, `metrics_monthly`. More invasive; also means per-segment rows are detail-only.

Until this is codified, `run.mjs` run as-is will double-count. Recommend **(A)**.

> Caveat: GA4 `users`/`new_users` per-channel sums *overcount* unique users (a user can appear in multiple channels). No active goal uses them today, but if one is added, query a separate unsegmented total for those two metrics rather than summing channels.

### 2. `orchestrator/.env` is missing required secrets → headless `run.mjs` cannot run
`SUPABASE_SERVICE_ROLE_KEY`, `INGEST_TOKEN`, and `META_ACCESS_TOKEN` are all **empty**. Also `node` is **not installed** in the scheduled environment (python3 is). Consequences:
- `run.mjs` / the `ingest-metrics` edge function path is unusable headless.
- This run wrote via the **Supabase MCP** (`execute_sql`) instead, and pulled Meta via the **Meta Ads MCP** (no Graph token needed).
- The hosted **Composio** key (`COMPOSIO_API_KEY`, 23 chars) returns **401** (`Invalid API key: ck_…`) — confirms the runbook's note. GA4/Sheets/Pages must use the Composio **MCP**, not the hosted API.

**Fix:** either (a) populate the three secrets + install node if you want the headless `run.mjs` CI path, or (b) accept the Claude-MCP routine as the supported runner and update `run.mjs`/docs to reflect it's the direct-creds *alternative* only.

### 3. Google Ads Ledger sheet is stale (export not running)
Sheet `1cEIfUfd_AFd4r82qt9p9imuo7oaqcJqwgZXAGXRSzhU` (tabs `Campaigns`, `Conversions`) contains **only** date serial `46191` = **2026-06-18** (35 campaign rows, 20 conversion rows). No data for 2026-06-21. The Google Ads Script that exports to this sheet (`orchestrator/google-ads-*.js`) appears not to have run for 3 days. **Fix the scheduled export**; the sync correctly ingested 0 rather than fabricating.

### 4. Facebook Pages: connection only manages 5/18 pages
Accessible (Analyze role): Deksia (`116149168419454`), KTU GR (`836992582832087`), KTU Lansing (`778242135381893`), KTU TC (`900068293178873`), RBMitchell (`270548709473600`). The other 13 page IDs are "not in your managed pages." Grant the connected FB user Analyze access to the remaining pages (3G, ECH, Engelsma, Green Shield, Hatton Power, Kellogg, KTU GR Forest Hills, Moda, Oleandri, Seven Apart, SST, StraightLineFence, Thornapple) or accept the gap.

### 5. CallRail v2 is sunset
`https://api.callrail.com/v2/...` now returns *"This API version has been sunset… migrate to v3."* `run.mjs` already uses v3 (`pullCallRail`, line ~101) — good. Just confirming any other v2 callers are updated.

---

## Implementation notes (how this run wrote data)

- **Write pattern:** pass the day's data as a compact `jsonb` literal to `execute_sql` and expand it server-side (`jsonb_each` + lateral unpivot), resolving `client_id`/brand from `client_sources` rather than a hardcoded map. ~4 KB payload instead of ~118 KB of `VALUES`. Idempotent via `on conflict (client_id,source,metric_name,metric_date,account_ext_id,entity,qualifier) do update`.
- **CallRail key:** `account_ext_id=company_id` so Hatton Power's two CallRail companies (`COM019d0618…` Hatton Wake, `COM019d0614…` Nebar) don't collide on the PK. (`run.mjs` currently leaves `account_ext_id=''`, which would make them overwrite each other — worth fixing there too.)
- **Meta `to_number`:** applied (`$`, `,`, `%`, `USD`, nbsp stripped; `"Not available"` → null). 6 of 13 accounts reported `lead` = "Not available" → those `leads` rows omitted (null), not zero.
- **Idempotency:** re-running this exact window overwrites in place (no duplicates). Verified PK and `do update` semantics.

## Verification snippet
```sql
select source, count(*), sum(value) filter (where metric_name='sessions') ga4_sessions
from public.metrics_daily where metric_date='2026-06-21' group by source order by source;
-- callrail 18 | ga4 880 (sessions ~18,590) | meta 84 | pages 20 ; google_ads absent (0)
```

## Connector availability matrix (this environment)
| Capability | Mechanism that works | Mechanism that does NOT |
|---|---|---|
| GA4 / Sheets / Pages | Composio **MCP** (`GOOGLE_ANALYTICS_RUN_REPORT`, `GOOGLESHEETS_BATCH_GET`, `FACEBOOK_GET_PAGE_INSIGHTS`), default connection | Composio **hosted** API key → 401 |
| Meta | Meta Ads **MCP** `ads_get_ad_entities` | Meta Graph token (not set) |
| CallRail | v3 REST + `CALLRAIL_API_KEY` (`callrail-mcp-server/.env`) | v2 REST (sunset) |
| Supabase writes | Supabase **MCP** `execute_sql` | PostgREST/edge fn (no service key/ingest token in `.env`) |
| node scripts | — | `node` not installed (use python3) |
