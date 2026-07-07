# Brief: Data Validation — Deksia Client Performance Platform

**Your role:** verify that the data flowing into the reporting platform is *correct* — that every
client is wired to the right ad/analytics accounts, that each goal measures the right thing from the
right source, and that the numbers reconcile against the native platforms (Google Ads, Meta, GA4,
CallRail). You are the human check on a system that was stood up fast and now needs ground-truthing.

You don't need to touch code. You need marketing-platform fluency, access to the accounts, and care.

---

## The system in 60 seconds
A scheduled job pulls each active client's daily marketing metrics from **four sources** —
**Google Ads, Meta, GA4, CallRail** — into one Supabase table (`metrics_daily`). Each client has
**SMART goals** (parsed from the *Smart Goal Tracker* Google Sheet) stored in a `goals` table; a
tracker compares actuals vs targets daily and records status + history. A dashboard reads it back.

```
 Smart Goal Tracker (Sheet) ─parse→ goals
 Google Ads · Meta · GA4 · CallRail ─daily pull→ metrics_daily ─tracker→ goal status + goal_progress (history) → dashboard
```

- **Supabase project:** `ykxauddrsnuwkvimkdhw` (`deksia-reporting`). Ask Matt for read access.
- **Goals workbook (READ-ONLY system of record for goals):** `1pFJqF6rrgMFczU8F73XHBjslDbYg571fgCwlLJBx0mk`
- **Reporting workbook (`_Reporting Config` registry + `_Coverage Roadmap`):** `1TYLr0slqT4UXAWwKJLgsabqETfp8TpgO0426_awR5JA`
- **Google Ads Ledger (daily export sheet):** `1cEIfUfd_AFd4r82qt9p9imuo7oaqcJqwgZXAGXRSzhU`
- **Coverage status at a glance:** the `_Coverage Roadmap` tab in the Reporting workbook.

## How the data is structured (enough to verify it)
- **`clients`** — one row per client (`slug`, status, timezone).
- **`client_sources`** — the mapping you'll scrutinize most: one row per (client, source, external_id).
  `source ∈ {google_ads, ga4, meta, callrail, pages}`; `external_id` = the account/property/company/page
  id; `params` holds flags (`confirmed`, `unconfirmed`, `brand`, `account_id`, notes).
- **`metrics_daily`** — the facts. Key = `(client_id, source, metric_name, metric_date, account_ext_id, entity, qualifier)`.
  - `account_ext_id` = sub-account (Ads CID / GA4 property / CallRail company), `entity` = campaign/brand,
    `qualifier` = channel group (GA4) or lead source (CallRail) or conversion action (Google Ads).
- **`goals`** — target_value, direction (increase/decrease), period, status, current_value, pct_to_target.
- **`goal_progress`** — append-only daily snapshots (the trend history).
- Helper views: `v_pipeline_health`, `v_goal_scoreboard`, `v_google_ads_performance`,
  `metrics_weekly`, `metrics_monthly`.

---

## The validation work — four layers

### Layer 1 — Source mapping (highest risk: a wrong ID = another client's data)
For **every active client**, confirm each connected source points at the **right** account. Cross-check
`client_sources` against what you see in the native platform. Pull the mapping with:
```sql
select c.slug, cs.source, cs.external_id, cs.params
from client_sources cs join clients c on c.id=cs.client_id
where cs.active order by c.slug, cs.source;
```
**Known ambiguities to resolve first** (these were best-guesses or are unconfirmed):
- **GA4 sibling properties** — pick the correct one among multiple: **Cascade** (~9 "Cascorp" properties),
  **Moda** (40 properties under "Moda Analytics"), **Nectar** (store property: 2 candidates),
  **StraightLineFence** (2). Confirm against the live site's GA4.
- **GA4 owner check** — property `308093077` is **Kellogg** (was briefly mis-assigned to Deksia);
  confirm **Deksia** = `309445314`.
- **Meta accounts** — confirmed by *June spend* (Moda → Medicare `567942467523634`, Oleandri
  `860604639208429`, KTU → "V2 KTU Boosted" `851287220971008`). Verify these are the *intended*
  managed accounts, not just whatever spent that month; reactivate a candidate if we picked wrong.
- **Multi-brand clients** — confirm each brand→id: **Hatton** (Wake / Nebar / Hatton Marine),
  **Morrison** (Integrity RV / RPM / RV Elite), **Contingent** (AR / OR / TN), **SST** (Main / Fueler),
  **Nectar** (Store / Ohio).
- **Goodside** — no IDs on file at all; find its Google Ads / GA4 / CallRail / Page identifiers.
- **Contingent TN** — Meta account is MCP-rollout-pending (not yet pullable); GA4 is mapped. Confirm.

### Layer 2 — Metric & attribution definitions (does each goal pull the *right* thing?)
For each goal, confirm the source + metric + filter match intent. Reference:
`.claude/skills/client-reporting/references/metric-catalog.md`. Key things to verify:
- **MQL definition** — loose (`calls + forms`) vs strict (lead-scored `leads`). Registry says all
  "loose" but some goals were seeded "strict." Confirm per client what the client actually agreed to.
- **CallRail source-split** — "leads attributed to Google Ads" must filter CallRail `source` to Google
  Ads; "Meta MQLs" to Facebook/Instagram Ads. Spot-check the `source` values are bucketed right.
- **GA4 channel splits** — SEO/organic goals must read the `Organic Search` channel group; paid-media
  GA4 goals the Paid Search/Social/Display groups.
- **Blended CPL** is **Meta-spend-only** until Google Ads spend is wired — every CPL number carries
  that caveat; make sure stakeholders know.
- **GA4 `users`/`new_users`** are not summed across channels (would overcount); confirm no goal relies
  on a channel-summed user count.

### Layer 3 — Value reconciliation (do the numbers match the native UIs?)
For a sample of clients per source, compare `metrics_daily` to the native platform for the same window:
```sql
select metric_name, qualifier, value from metrics_daily
where client_id=(select id from clients where slug='Green Shield')
  and source='meta' and metric_date='2026-06-21' order by metric_name;
```
Open Meta Ads Manager / Google Ads / GA4 / CallRail for that client + date and confirm they tie out.
Watch for: timezone boundaries (platform uses **America/New_York**), Meta display-string parsing
(`$`, `%`, "Not available"→blank), and **backfill artifacts** — some early rows (≈2026-06-18/19) are
one-time **month-to-date aggregates** at a different grain than the daily routine; confirm they aren't
inflating month-to-date goal totals.

### Layer 4 — Goal definitions (do targets match the Smart Goal Tracker?)
For each goal, confirm `target_value`, `direction`, period/cadence, and baseline match the client's tab
in the **Goals workbook**. Flag source discrepancies already noted (e.g., Green Shield CTR goal text
says 1.5% but Benchmark cell says 2%; Deksia clicks 2,000 vs 1,500). Use `v_goal_scoreboard` to eyeball
statuses for sanity (an "off_track at 12%" with 25 days left may just be early-month pacing, not wrong).

---

## Known issues punch-list (verify / drive to closure)
1. **Google Ads Ledger export is stale** (last data 2026-06-18). The MCC Script that writes the Ledger
   sheet stopped — get it running again, then confirm Google Ads rows resume in `metrics_daily`.
2. **Facebook Pages: only 5 of 18 accessible.** Grant the connected FB user an **Analyze** role on the
   missing pages (3G, ECH, Engelsma, Green Shield, Hatton, Kellogg, KTU GR Forest Hills, Moda, Oleandri,
   Seven Apart, SST, StraightLineFence, Thornapple).
3. **Oleandri GA4** returns 0 sessions some days — confirm the property/site is correct and has traffic.
4. **`connector_health` legacy rows** — duplicate old-label rows coexist with new source slugs; cosmetic,
   safe to clean.
5. **Out-of-scope sources** (no connector — will always show "Awaiting"): YouTube, OTT, Pinterest,
   LinkedIn, Email, CRM/SQL figures. Don't chase these as "broken."

## Suggested order (validate the data-rich, live clients first)
Green Shield, ECH, Kellogg, Moda, Seven Apart, Cascade, 3G, Veritas → then Engelsma, Hatton, Thornapple,
StraightLineFence, RBMitchell, SST, BHS, Contingent → then the "needs mapping" set (Goodside, Crystal
Clean, Morrison, Nectar, SAMorman, Perchance, Signcomp).

## What to hand back
A per-client **sign-off matrix** — for each (client × source): mapping correct? values reconcile?
goal target correct? — plus a **corrections log** (wrong id → right id, wrong MQL def, target typo, etc.).
Send corrections to Matt; the platform-side updates (editing `client_sources` / re-confirming) are quick.

## Reference docs (in the repo)
- `_Coverage Roadmap` tab — current per-client source coverage.
- `.claude/skills/client-reporting/references/registry.md` — IDs, account candidates, ambiguity notes.
- `.claude/skills/client-reporting/references/metric-catalog.md` — goal-phrase → source/metric/direction.
- `.claude/skills/client-reporting/references/parser.md` — how goal tabs are parsed.
- `orchestrator/daily-run.md` — what the daily sync does, per source.
