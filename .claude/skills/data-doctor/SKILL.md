---
name: data-doctor
description: >-
  Scan the Deksia reporting platform for data and connection problems — missing days for a
  client's mapping, mappings that never produced rows, unreachable accounts, expiring or broken
  credentials, stuck backfills, stale rollups, a failed daily run — and apply the safe fixes
  (re-pull from the platform, refresh rollups, re-run a failed source), then report what was fixed
  and what needs Matt. Use on a routine (daily after the 11:00 UTC pull), or when asked to
  "run the doctor", "check the data", "find gaps", "why is a client missing data",
  "scan the connections", or "heal the pipeline".
---

# Data doctor

The pipeline already heals itself per SOURCE (the integrity sentinel re-pulls a day no client
has). The doctor works per CLIENT MAPPING, where one client's missing day is invisible to the
sentinel, and it covers the things nothing else watches: mappings that never pulled, access that
was revoked, credentials about to expire, backfills that gave up, rollups that stopped, a daily
run that failed. Every run and every action is written to `public.doctor_runs`.

## Rules (Matt's standing rules — never bend them)

1. **Never edit, fill, or derive data.** The only data fix is a re-pull from the platform
   (a backfill job). It is idempotent: a genuinely empty day stays empty.
2. **Re-pull a (mapping, day) at most once.** `doctor_findings()` already marks days the doctor
   has re-pulled before as `verified_empty`; they are reported, never re-queued. Do not work
   around this by queueing jobs by hand.
3. **Credentials, access grants and API enablement are reported, never touched.** No token is
   ever read or set here. Say exactly what Matt must do.
4. **Quota.** Google Ads: the fixer queues at most one job per run (Explorer cap is 3 chunks a
   day). Meta: never dispatch more than one extra full daily run in a day — many manual runs trip
   the app's rate limit. Prefer `only_source=…` re-runs.
5. **Provenance.** Everything the doctor queues is stamped `created_by = 'doctor/<actor>'`. Say
   who you are in `p_actor` (e.g. `routine 2026-09-17`).

## It already runs weekly

`.github/workflows/health-check.yml` runs `orchestrator/health-check.mjs` every **Monday 12:00 UTC**
(8:00 AM ET, an hour after the daily pull), which calls `doctor_fix` and emails one summary. Run it
by hand from the Actions tab any time, with `dry_run: true` to look without changing anything.
Use this skill when you want to investigate interactively, or to interpret what that run reported.

## Procedure

Supabase project: `ykxauddrsnuwkvimkdhw`. Repo: `Highamm-coder/deksia-v2-reporting`.

### 1. Scan and fix in the database (one call)

```sql
select public.doctor_fix('routine <YYYY-MM-DD>', false, 8);
```

Returns `{ run_id, n_findings, n_actions, actions[], findings[] }`. Findings carry
`kind`, `severity` (high | warn | info), `slug`, `source`, `account`, `detail`, `fix`.
The function has already applied the safe fixes:

| finding | what the fixer did |
|---|---|
| `client_gap` | queued one backfill job per (client, source) covering the gap range |
| `never_pulled` (reachable) | queued a 30-day first pull |
| `stale_rollup` | ran `refresh_rollups()` |

Everything else is report-only: `unreachable`, `credential_bad`, `credential_expiring`,
`chunk_exhausted`, `chunk_deferred`, `db_size`, `discovered_unmapped`, `verified_empty`,
`gap_in_flight`.

To look without acting, use `p_dry_run => true` (the run is still logged, flagged dry).

### 2. Start the backfill runner if anything was queued

If `actions` contains `queued_repull` or `queued_first_pull`:

```bash
gh workflow run backfill.yml -R Highamm-coder/deksia-v2-reporting
```

The runner takes three chunks per run; the scheduled runner (every two hours) drains the rest.
Do not loop-dispatch it.

### 3. Check the daily run

```bash
gh run list -R Highamm-coder/deksia-v2-reporting -w orchestrate.yml -L 3 --json conclusion,createdAt,event,databaseId
```

If the latest **scheduled** run failed, read its log for `FAILED sources:` and `google token`:

```bash
gh run view <id> -R Highamm-coder/deksia-v2-reporting --log 2>&1 | grep -i 'FAILED sources\|google token\|rate limit\|Source health'
```

- `invalid_grant` / `expired` / `401` / `403` → credential or access problem → **report only**.
- A transient failure on one source (5xx, timeout, `Retry in N seconds`) and no doctor re-run yet
  today (check `doctor_runs.actions` for `rerun_daily`) → re-run just that source for yesterday:

  ```bash
  gh workflow run orchestrate.yml -R Highamm-coder/deksia-v2-reporting -f run_date=<yesterday> -f only_source=<source>
  ```

  Then append the action to the run's log so the next run knows:

  ```sql
  update public.doctor_runs set actions = actions || '[{"action":"rerun_daily","source":"<source>","run_date":"<yesterday>"}]'::jsonb,
         n_actions = n_actions + 1 where id = <run_id>;
  ```

### 4. Report

One message, three short sections, plain language, no numbers in prose unless they change what
Matt does:

- **Fixed** — each action in one line: client, source, date range, what was queued or refreshed.
- **Needs Matt** — every `high` finding and every `credential_*`: what is wrong and the exact
  step (grant access to social@deksia.com on X; re-mint token; enable API Y in the Cloud
  project; map or ignore N discovered accounts).
- **Watching** — `verified_empty`, `gap_in_flight`, `chunk_deferred`, `db_size` as one line each
  or a count.

If `n_findings = 0`: say so in one line and stop.

## Reading the findings honestly

- `client_gap` only fires for a **dense** mapping (rows on ≥ 80 % of days in the last 30) and
  only for days the source as a whole was pulled. A sparse mapping (a CallRail company with
  occasional calls, a Search Console property with rare impressions) produces no expected days,
  so its quiet days are not findings. Do not "fix" sparseness.
- `verified_empty` means the doctor re-pulled once and the platform returned nothing. That is
  the platform's answer, not a gap. Never zero-fill it.
- Search Console lags three days and YouTube two; the horizon already accounts for that.
- Snapshot metrics (YouTube `*_total`) are dated the pull day and aggregate as `last`; a month
  shows the latest snapshot, never a sum.

## What the doctor must never do

Set or read a secret · edit `fact_daily` · delete anything · queue a job for a range the doctor
already re-pulled · dispatch a full daily run more than once a day · change a mapping, a client,
or a metric definition · merge or push to `main`.
