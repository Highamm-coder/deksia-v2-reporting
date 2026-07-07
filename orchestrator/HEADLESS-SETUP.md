# Hands-free daily refresh — setup

This makes the dashboard refresh **every morning with no Claude, no LLM, and no app open.**
GitHub Actions runs [`run.mjs`](run.mjs) on a cron; it pulls each active client's metrics
**direct from the vendor APIs**, upserts them into `metrics_daily` (idempotent), and runs the SMART
goal tracker. The console reads the fresh data automatically — no rebuild.

```
GitHub Actions cron (11:00 UTC / 07:00 ET, daily)
   └─ node orchestrator/run.mjs
        ├─ GA4        → Analytics Data API   (service account)
        ├─ Google Ads → Sheets API on Ledger (service account)   ← MCC Script still fills the sheet
        ├─ Meta       → Graph API            (system-user token)
        ├─ CallRail   → REST v3              (API key)
        └─ Pages      → Graph API            (best-effort, same Meta token)
      → ingest-metrics edge fn → metrics_daily → run_goal_tracker() → run_log
```

Why direct APIs (not Composio): the GA4/Sheets/Meta Composio connections are **Claude-managed** and
can't authenticate from a server (confirmed 401 headless). Going direct removes that dependency —
the price is a one-time credential setup below.

---

## The 6 GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add each:

| Secret | Where to get it |
|--------|-----------------|
| `SUPABASE_URL` | `https://ykxauddrsnuwkvimkdhw.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |
| `INGEST_TOKEN` | Supabase SQL editor: `select decrypted_secret from vault.decrypted_secrets where name='ingest_token';` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the whole service-account JSON file (see below) |
| `META_ACCESS_TOKEN` | Meta system-user token (see below) |
| `CALLRAIL_API_KEY` | your existing CallRail v3 API key |

> None of these are ever shown to me — you paste them straight into GitHub. The service-role key and
> ingest token stay server-side; they never touch the browser or the console.

---

## 1. Google service account (covers GA4 **and** Google Ads Ledger)

1. <https://console.cloud.google.com> → pick/create a project.
2. **APIs & Services → Enable APIs** → enable **Google Analytics Data API** and **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create** (e.g. `deksia-reporting`). No roles needed at the
   project level.
4. Open the account → **Keys → Add key → Create new key → JSON** → download it. Copy the file's
   entire contents into the `GOOGLE_SERVICE_ACCOUNT_JSON` secret.
5. **Grant GA4 access:** GA4 → **Admin → Account access management** (account level, so it sees all
   properties at once) → add the service account's `client_email` (from the JSON) with the **Viewer**
   role. (Per-property works too but is 30× the clicks.)
6. **Grant Ledger access:** open the Google Ads Ledger sheet
   (`1cEIfUfd_AFd4r82qt9p9imuo7oaqcJqwgZXAGXRSzhU`) → **Share** → add the same `client_email` as
   **Viewer**.

## 2. Meta system-user token (Meta ads + Pages)

1. <https://business.facebook.com> → **Business Settings → Users → System Users → Add** (a
   system user gives a token that doesn't expire with a person's login).
2. **Generate new token** → select the app → scopes: **`ads_read`** (required). For Facebook Pages
   also add **`pages_read_engagement`** and **`read_insights`**.
3. **Assign assets** to the system user: the ad accounts (and Pages) you want pulled, with at least
   read/analyze access.
4. Copy the token into the `META_ACCESS_TOKEN` secret.

## 3. Google Ads — keep the MCC Script running

Google Ads data reaches us via the **MCC Google Ads Script** that appends daily rows to the Ledger
sheet (see `orchestrator/google-ads-mcc-script.js`). That script runs **inside Google Ads on its own
schedule** — it's already headless. Just make sure it's scheduled and not paused (it went stale on
2026-06-18 once before). `run.mjs` then reads the sheet via the service account. If the sheet is
stale, Google Ads rows simply won't update — the run stays green for the other sources.

---

## Turn it on & test

1. Add all 6 secrets.
2. Repo → **Actions → deksia-daily-sync → Run workflow** (optionally set `run_date` to backfill a
   specific day, e.g. `2026-07-06`). This is the same job the cron runs.
3. Watch the log — it prints `Ingested rows: {...}` and `Source health: {...}` per source, and exits
   non-zero if any source fully failed.
4. Confirm in Supabase: `select source, max(metric_date), count(*) from metrics_daily group by source;`
   and check the newest `run_log` row. Then open a client in the console — fresh numbers.

After that, it runs automatically at **11:00 UTC (07:00 ET) daily**. Everything is idempotent, so a
manual re-run or overlapping run never double-counts.

## Coverage notes / expected gaps
- **Pages** is best-effort: only pages managed by the token owner with an Analyze role return data
  (~5/18 today). Others skip quietly — grant the role in Meta Business Settings to add them.
- **Oleandri GA4** has returned 0 sessions some days — verify the property is correct.
- The older **Claude scheduled routine** (`deksia-daily-sync` in the desktop app) can stay as a
  manual backup or be disabled — this GitHub Actions job is now the source of truth.
