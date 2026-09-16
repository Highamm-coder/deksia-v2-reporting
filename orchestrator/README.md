# Orchestration — Deksia Client Performance + SMART Goals Platform

Three cooperating schedulers keep the platform fresh. All steps are idempotent and
keyed; re-running any of them is safe. Date boundaries are **America/New_York**.

```
 Google Ads MCC Script ──POST(cid,rows)──► ingest-metrics ─┐
 GitHub Actions runner ──POST(slug,rows)──► ingest-metrics ─┼─► metrics_daily (idempotent upsert)
   • CallRail (REST)                                         │
   • GA4 / Meta (Composio extension point)                   │
 pg_cron (in-DB) ──────────────────────────────────────────┴─► run_goal_tracker() ─► goal_progress + goals.status
```

## 1. In-DB goal tracker (live now)
`pg_cron` job **`goal-tracker-daily`** runs `public.run_goal_tracker()` at `0 10 * * *` UTC.
Reads latest actuals from `metrics_daily`, writes an append-only `goal_progress` snapshot,
updates denormalized status on each `goals` row. No external dependencies.

## 2. Google Ads (push)
`google-ads-mcc-script.js` → paste into the **DEKSIA MCC (929-098-5791)** Google Ads Scripts,
set `INGEST_TOKEN`, schedule daily. It POSTs each account's daily metrics to `ingest-metrics`,
which resolves the client by **CID** against `client_sources`. Seed one `google_ads`
`client_source` per client with `external_id` = the account CID first.

## 3. Pull sources (GitHub Actions)
`.github/workflows/orchestrate.yml` runs `orchestrator/run.mjs` daily (10:00 UTC) and on demand.
Per active client+source it pulls yesterday's metrics and POSTs to `ingest-metrics`, then
triggers the tracker via RPC.
- **CallRail** — implemented (CallRail v3 REST: calls + form submissions per day).
- **GA4 / Meta** — Composio extension point in `run.mjs` (`pullComposio`); wire to the
  Composio execute API once `COMPOSIO_API_KEY` + tool slugs are set. Until then GA4/Meta are
  pulled by the Claude `client-reporting` routine.

### Required GitHub secrets
| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | `https://ykxauddrsnuwkvimkdhw.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | read `client_sources`, call `run_goal_tracker` RPC |
| `INGEST_TOKEN` | bearer for `ingest-metrics` (stored in Supabase Vault as `ingest_token`) |
| `CALLRAIL_API_KEY` | CallRail v3 API key |
| `COMPOSIO_API_KEY` | (optional) GA4/Meta pulls |

## Secrets
The ingest bearer lives in **Supabase Vault** (`ingest_token`); the edge functions read it via
the `get_ingest_token()` security-definer RPC (service-role only). Never hardcode it — the values
above are referenced from GitHub Actions secrets / Vault, not committed.

## Adding a client
Insert a `clients` row + its `client_sources` (platform IDs). That alone starts data flowing:
the runner picks it up on the next run; goals authored against catalogued metrics begin tracking.

## Ops notes
- **Token split (2026-06):** the ingest write path (`ingest-metrics`) and the dashboard read path
  (`dashboard-data`) use **separate** Vault secrets: `ingest_token` and `dashboard_token`. Retrieve
  either from the Supabase SQL editor (never commit/paste into chat):
  `select decrypted_secret from vault.decrypted_secrets where name='dashboard_token';`
- **Ledger sheet growth:** the Google Ads scripts append daily rows to the Ledger sheet
  (`Campaigns`/`Conversions`). Rotate or archive tabs every ~90 days to keep reads fast; the
  ingest dedups per (cid,campaign,date) so pruning old rows is safe.
