# Reporting Workbook, Config Registry & Dashboard

## Workbook IDs

- **Goals workbook (READ-ONLY):** `1pFJqF6rrgMFczU8F73XHBjslDbYg571fgCwlLJBx0mk`
- **Reporting workbook (read/write):** `1TYLr0slqT4UXAWwKJLgsabqETfp8TpgO0426_awR5JA`
  ([open](https://docs.google.com/spreadsheets/d/1TYLr0slqT4UXAWwKJLgsabqETfp8TpgO0426_awR5JA/edit))
  - `_Reporting Config` sheetId `0` · `Reporting Dashboard` sheetId `1850689223`
- Google account: `matthew@deksia.com` (Composio googlesheets).
- **CallRail master account:** `ACC1f1e633474304b16b41941a520b5432a` ("Deksia", numeric 334191050) —
  one account for all clients. Per-client `company_id` is in `_Reporting Config` col G (12 matched
  2026-06-18). All matched companies have `lead_scoring_enabled=true`, so `strict` MQL is available.

## `_Reporting Config` tab — schema (one row per goal tab)

| Col | Field | Notes |
|---|---|---|
| A | Client Tab Name | exact title of the goal tab (join key) |
| B | Status | `active` / `paused` / `archived` (only `active` runs) |
| C | Full Client Name | from goal-tab row 1 |
| D | Meta Ad Account ID(s) | numeric, no `act_`; comma-separate if multiple (sum) |
| E | GA4 Property ID | `properties/<id>` |
| F | CallRail Account ID | likely one master account for all clients |
| G | CallRail Company ID | per client |
| H | Client Time Zone | IANA; default `America/Detroit` |
| I | Monthly Budget (USD) | basis for cost-per-MQL pacing |
| J | MQL Definition | `loose` (default) or `strict` |
| K | Recipients | notification targets (emails / Slack) |
| L | Notes | ambiguity flags, "needs mapping", caveats |
| M | Facebook Page ID | numeric Page ID for organic (Pages source); 15 matched 2026-06-18 |

(Tab is widened to 14 cols to fit M. Add an `Instagram Business Account ID` col only if the `instagram` toolkit is connected.)

### Confirmed Meta ad-account IDs (verified MCP-enabled + queryable)

| Client tab | Meta Ad Account ID |
|---|---|
| Green Shield | 164626062105963 |
| ECH | 1833931353307885 |
| SST | 16231739 |
| Engelsma Homes | 252762372404888 |
| Kellogg | 183463532720859 |
| Seven Apart | 294549359979134 |
| Thornapple | 367312902402109 |
| Hatton Power | 1507263374306192 |
| RBMitchell | 442780278451816 |

### Ambiguous — multiple active accounts, confirm with user (put all candidates in D, flag in L)

- **Moda**: 651196776743431 (Health owned), 567942467523634 (Medicare), 309296895016284 (Pebb); MCP-disabled: 6876852115733114, 2308334376062350.
- **KTU Pash**: 1271152180327906, 519537874156631, 851287220971008, 337053989398424.
- **Oleandri Wines**: 860604639208429, 1404499337464339.
- **Every Child** (which tab? Contingent?): 258692031435170, 339258043740818 (Oregon); 404646208539513 (Arkansas); 999503171617145 (TN, not MCP-enabled).

### Unmapped (Meta blank, Note "needs mapping")
BHS, Cascade, Crystal Clean, Goodside, Morrison, Nectar, Perchance, SAMorman, Signcomp,
StraightLineFence, Veritas, 3G. (Deksia brand acct, if ever needed: 1028914387142923.)

## Output = per-client mirror tabs (exact clones of the tracker)

The output is **one tab per client**, an exact clone of that client's goal tab (same layout,
columns `Tactic | Status | Goal | Cadence | Benchmark | Results | Historical Notes | Practioner`,
and formatting), with only **Status** (col B) and **Results** (col F) automated. Everything else is
copied verbatim from the source. This is what "match the Smart Goal Tracker exactly, with results
automated" means.

### Build a mirror tab (idempotent — re-run safe)
1. Resolve the source tab's numeric `sheetId` in the goals workbook
   (`GOOGLESHEETS_GET_SPREADSHEET_INFO`, `fields=sheets.properties(sheetId,title)`).
2. If a tab of the same name already exists in the Reporting workbook, delete it
   (`GOOGLESHEETS_DELETE_SHEET`).
3. `GOOGLESHEETS_SPREADSHEETS_SHEETS_COPY_TO` (`spreadsheet_id`=goals wb, `sheet_id`=source sheetId,
   `destination_spreadsheet_id`=Reporting wb) → creates `Copy of <Tab>` preserving formatting.
4. Rename `Copy of <Tab>` → `<Tab>` (`GOOGLESHEETS_UPDATE_SHEET_PROPERTIES`, `fields:"title"`).
   Re-cloning every run keeps the mirror structurally in sync with the tracker.

### Overlay automation (only cols B + F)
One `GOOGLESHEETS_UPDATE_VALUES_BATCH` (`RAW` — preserves exact text, avoids formula/number coercion),
writing only B and F of each tactic row (batch contiguous runs, e.g. `B26:B29`, `F26:F29`):
- **Status (B):** measured → `On Track` (attainment ≥ 100%) / `Off Track` (< 100%); unmeasured → `Awaiting`.
  (Matches the tracker's own On Track / Off Track vocabulary. A finer band — e.g. "Slightly Behind"
  85–100% — is a config option if the team wants it.)
- **Results (F):** measured → `<Period>: <actual> <unit> (<attainment>% of goal) — auto <date>`;
  unmeasured → marker: `Awaiting Google Ads connector (Phase 5)` · `Awaiting CallRail (server offline)` ·
  `Awaiting GA4 setup` · `Out of scope — <organic/Pinterest/YouTube/OTT> (no connector)`.
- Never write C/D/E/G/H (Goal/Cadence/Benchmark/Historical Notes/Practitioner) — they stay as the source.
- Surface any source inconsistency in Results rather than guessing (e.g. a CTR goal whose Benchmark
  cell disagrees with the goal text → note "check benchmark").

Status colors: if the cloned tab already carries the tracker's own Status formatting, leave it. To add
auto-coloring, `GOOGLESHEETS_MUTATE_CONDITIONAL_FORMAT_RULES` on col B (`TEXT_EQ`): On Track `#34a853`,
Off Track `#ea4335`, Awaiting `#9e9e9e`.

## Bootstrapping IDs (one-time, per source)

- **GA4 property IDs**: `GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES` → flatten `displayName`→`properties/<id>`
  (paginate). Human name-match to client tabs; store in col E. A 403 means the GA Admin scope is missing —
  flag the row and continue.
- **CallRail IDs**: `callrail_list_accounts` → `callrail_list_companies(status:"active", per_page:250)`;
  match `company.name` to the Full Client Name; store account in F (one master likely → same value for all),
  company in G. (Requires the hosted CallRail MCP connected.)
- **Facebook Page IDs (Pages source)**: `FACEBOOK_LIST_MANAGED_PAGES` (`fields:"id,name,category,fan_count,followers_count"`
  — omit `access_token`, it's a secret); match `name` to the Full Client Name; store the numeric id in col M.
  15 matched 2026-06-18. Ambiguous (multiple pages): KTU Pash (several Kitchen Tune-Up pages). Instagram organic
  would need the `instagram` toolkit connected + IG Business account IDs.
- **Meta**: pre-filled above; resolve the ambiguous set with the user.

## Optional: `Run Log` tab
Append one row per run: `timestamp | period | clients_run | tactics_auto | tactics_blocked | errors`.
Useful for history/trend and debugging scheduled runs.
