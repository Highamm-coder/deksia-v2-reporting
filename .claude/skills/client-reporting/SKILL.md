---
name: client-reporting
description: >-
  Generate automated client reporting — actuals vs goals — for Deksia clients.
  Reads each client's SMART goal tab from the Goals workbook, pulls actuals from
  Meta Ads (paid), Facebook Pages (organic), GA4, and CallRail, compares against the per-tactic Benchmark targets,
  computes attainment + status, and writes a roll-up dashboard to the separate
  Reporting workbook. Use when asked to "run client reporting", "generate the
  monthly report", "update the dashboard", "report actuals against goals",
  "compare benchmark vs actual", or "pull <client>'s numbers vs their goals".
---

# Client Reporting

Automates the manual monthly data-pull in Deksia's **Smart Goal Tracker**. For each
active client it reads the goal tab, parses every tactic row, fetches the matching
actual from the right connector, evaluates it against the Benchmark, and writes the
result into a **per-client mirror tab** in the Reporting workbook — an exact clone of
that client's Smart Goal Tracker tab (same layout, formatting, and every other column)
with only the **Status** and **Results** columns automated. The Goals workbook is never modified.

## Two workbooks (never confuse them)

- **Goals workbook** `1pFJqF6rrgMFczU8F73XHBjslDbYg571fgCwlLJBx0mk` — the Smart Goal
  Tracker. One tab per client. **READ-ONLY. Never issue a write to this ID.**
- **Reporting workbook** `1TYLr0slqT4UXAWwKJLgsabqETfp8TpgO0426_awR5JA` — separate spreadsheet this
  skill owns. Holds `_Reporting Config` (the client→IDs registry) and **one mirror tab per client**
  (the automated output, cloned from the goal tab). See `references/registry.md`.

## Arguments

- `--client "<Tab>"` — run one client (exact goal-tab title). Omit = all `active` clients.
- `--period YYYY-MM` — reporting month. Default = **prior full calendar month**.
- `--sources meta,pages,ga4,callrail` — restrict connectors. Default = all configured.
- `--target sheets|supabase|both` — where to write. Default `both`. The **daily** snapshot run uses
  `supabase`; the **monthly** client-facing refresh uses `sheets` (or `both`).
- `--dry-run` — parse + fetch + evaluate, print the result table, **do not write** anything.

## Procedure

1. **Resolve tabs + sheetIds.** `GOOGLESHEETS_GET_SPREADSHEET_INFO`
   (`fields=sheets.properties(sheetId,title)`) on the Reporting workbook; cache the
   `Reporting Dashboard` sheetId. Resolve `--client` against exact tab titles in the Goals workbook.
2. **Read the registry.** `GOOGLESHEETS_BATCH_GET _Reporting Config!A:L` from the Reporting
   workbook. Keep rows where `Status = active`. For each, resolve the reporting period's
   `since`/`until` in the client's time zone (col H, default `America/Detroit`).
3. **Per client — read the goal tab.** One `GOOGLESHEETS_BATCH_GET <Tab>!A1:Z<rows>` from the
   Goals workbook.
4. **Parse tactics** following `references/parser.md`: locate tables by header anchor, classify
   channel (goal-text prefix overrides the Tactic column), extract metric, parse the Benchmark,
   look up the catalog entry, and assign a coverage verdict (AUTO / BLOCKED / NEEDS_MAPPING).
5. **Fetch actuals** for AUTO rows (BLOCKED/NEEDS_MAPPING skip straight to No Data). One call per
   source per client (see "Connector calls" below). Month-over-month in a single call where possible.
6. **Normalize + evaluate** per `references/metric-catalog.md`: run the Meta string normalizer,
   map GA4 date-range buckets, compute MQL per the client's MQL Definition (col J), then compute
   direction-aware attainment with mid-month proration → Status + color.
7. **Refresh the mirror tab** (idempotent): if a tab named `<Tab>` already exists in the Reporting
   workbook, delete it (`GOOGLESHEETS_DELETE_SHEET`); then clone the source tab with
   `GOOGLESHEETS_SPREADSHEETS_SHEETS_COPY_TO` (goals spreadsheet → Reporting workbook, preserving
   layout + formatting) and rename the `Copy of <Tab>` result to `<Tab>`
   (`GOOGLESHEETS_UPDATE_SHEET_PROPERTIES`). Re-cloning each run keeps the mirror's structure in sync
   with the tracker automatically. Skip the whole write on `--dry-run`.
8. **Overlay the automation**: one `GOOGLESHEETS_UPDATE_VALUES_BATCH` (`RAW`) writing ONLY the
   **Status** (col B) and **Results** (col F) cells of each parsed tactic row — addressed by absolute
   row index, contiguous runs batched. Never touch Goal/Cadence/Benchmark/Historical Notes/Practitioner.
   - Measured: Status = `On Track` (attainment ≥ 100%) / `Off Track` (< 100%); Results =
     `<Period>: <actual> (<attainment>% of goal) — auto <date>`.
   - Unmeasured: Status = `Awaiting`; Results = a clear marker — `Awaiting Google Ads connector
     (Phase 5)`, `Awaiting CallRail (…)`, `Awaiting GA4 setup`, or
     `Out of scope — <organic/Pinterest/YouTube/OTT> (no connector)`.
   - Multi-brand clients (col G is a brand-map): route each tactic to its brand's CallRail company —
     see `references/parser.md` § 3b.
9. **Report** a run summary: per client, the AUTO vs BLOCKED tactic counts and any caveats
   (Meta-spend-only CPL, GA4 SEO-proxy, ambiguous account, missing ID).

## Connector calls (exact tools)

- **Meta** → `mcp__0411b1f5-5a54-453b-9112-05ce443572f3__ads_get_ad_entities`
  - `ad_account_id` (numeric, no `act_`), `level:"account"` (use `"campaign"` to align Campaign #1–4),
    `time_range:{"since":"<m-01>","until":"<m-end>"}` + `time_increment:"monthly"` for MoM in one call,
    XOR `date_preset:"last_month"`.
  - `fields:["impressions","reach","clicks","ctr","cpc","cpm","amount_spent","frequency",
    "actions:link_click","cost_per_link_click","lead","cost_per_action_type",
    "actions:omni_purchase","purchase_roas","video_thruplay_watched_actions"]`.
  - Multiple accounts (Moda/KTU/Oleandri/Every Child): query each, **sum** counts, recompute rates.
  - On a 400, validate field names with `ads_get_field_context`.
- **Pages (organic FB)** → `FACEBOOK_GET_PAGE_INSIGHTS` (Composio) — `page_id` (registry col M), `period:"day"`,
  `since`/`until`, `metrics:"page_follows,page_daily_follows_unique,page_daily_unfollows_unique,page_media_view,page_post_engagements,page_video_views"`.
  Sum daily values over the window; net follows = follows − unfollows. Empty `{}` = no data (not 0). Org-link-clicks
  has no Page-level metric → mark partial. (Instagram organic needs the `instagram` toolkit — not connected.)
- **GA4** → `GOOGLE_ANALYTICS_RUN_REPORT` (Composio)
  - `property:"properties/<id>"`, two `dateRanges` (current + prior), `metrics` (≤10),
    `dimensions:[{name:"sessionDefaultChannelGroup"}]`, `metricAggregations:["TOTAL"]`.
  - SEO proxy → `dimensionFilter` on `sessionDefaultChannelGroup = "Organic Search"`;
    Paid Media → `"Paid Social"|"Paid Search"|"Display"`.
  - Resolve `keyEvents` vs `conversions` per property once via `GOOGLE_ANALYTICS_GET_METADATA`.
- **CallRail** → hosted MCP `callrail_get_call_summary` + `callrail_get_form_summary`
  - `company_id`, `start_date`/`end_date`, `time_zone`; `call_summary` fields
    `total_calls,first_time_callers,leads`; `form_summary` fields `total_forms,leads`.
  - Two windows (prior + current) for MoM. **Do not** use `callrail_list_leads` for monthly
    totals — it has no date filter.
- **Sheets** → `GOOGLESHEETS_*` (Composio) for read/write/format. Account: matthew@deksia.com.
- **Supabase data layer** → project `ykxauddrsnuwkvimkdhw` (`deksia-reporting`,
  https://ykxauddrsnuwkvimkdhw.supabase.co). Write via the Supabase MCP `execute_sql`.

## Data layer (Supabase) — daily snapshots

When `--target` includes `supabase`, after evaluating each client UPSERT one row per parsed tactic
into `public.metric_snapshots` (PK `(snapshot_date, client, goal_row)` → re-running a day overwrites):
```sql
insert into public.metric_snapshots
  (snapshot_date, period, client, full_client_name, campaign, tactic, channel, metric, source,
   target, actual, attainment, status, unit, note, goal_row)
values (...)
on conflict (snapshot_date, client, goal_row) do update set
  actual=excluded.actual, attainment=excluded.attainment, status=excluded.status,
  note=excluded.note, inserted_at=now();
```
- `snapshot_date` = run date; `period` = the window the actual covers (`'2026-05'`, `'2026-Q2'`).
- `actual`/`target` numeric (strip %/$); `attainment` as a ratio (1.0 = 100%); `unit` ∈ int/pct/usd/ratio.
- Awaiting/blocked rows: write the row with `actual=null` + the reason in `note` (so coverage is queryable).
- Then refresh `public.connector_health` (upsert one row per source: flowing/degraded/idle/not_flowing/offline)
  and append a `public.run_log` row (period, clients_processed, rows_written, sources, notes).

**Split cadence:** daily → `supabase` (trend/pacing history); monthly → `sheets` (client-facing mirror tabs).
**Reachability:** a *cloud*-scheduled run can reach Meta/GA4/Pages (Composio) + Supabase, but NOT the
CallRail server if it's on `localhost` — host CallRail reachably (HTTP) or run the daily job on the Mac
where the server lives, else CallRail rows fall back to "Awaiting (server unreachable)."

## Hard rules

- **Never write to the Goals workbook** (`1pFJqF6...`). All writes go to the Reporting workbook.
- **Meta values are display strings** ("$7,852.95 USD", "1.71%", nbsp-separated) — always run
  `to_number` before comparing. `""`/"Not available" → None (No Data), never 0.
- **Sheets formula-injection guard**: with `valueInputOption:"USER_ENTERED"`, any text cell whose
  value starts with `+`, `=`, `-`, or `@` is parsed as a formula and yields `#ERROR!`
  (e.g. a target written as `+1% vs 7,043`). For free-text Target/Note cells, write descriptive
  text that starts with a letter/digit (`1% increase vs 7,043 baseline`), or use `RAW`. Numbers and
  `%`/`$` values that should be parsed still use `USER_ENTERED`.
- **Distinguish No Data from zero**: an API error or missing ID → "No Data"; a genuine 0 → 0.
- **Idempotent**: re-running the same client+period overwrites its dashboard rows in place.
- **Rate limits**: Sheets 60 reads + 60 writes/min → 1 read + 1 batched write per client,
  pace ~1 client / 2s, exponential backoff on 429/503. CallRail ~1k/hr + 25-month retention
  → summary endpoints only.
- **Coverage honesty**: BLOCKED rows (Google Ads, organic followers, Pinterest/YouTube/OTT) are
  marked grey "No Data (out of scope)" — never guessed. Annotate Meta-spend-only CPL and GA4
  SEO-proxy in the Note column.

## References

- `references/metric-catalog.md` — goal phrase → source/metric/direction/coverage; normalizer; attainment + status rules.
- `references/parser.md` — table location, channel classification, metric extraction, benchmark parsing.
- `references/registry.md` — Reporting workbook ID + `_Reporting Config` schema, confirmed Meta IDs, dashboard layout, formatting, bootstrapping GA4/CallRail IDs.
