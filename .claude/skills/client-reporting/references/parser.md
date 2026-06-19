# Goal-Tab Parser

How to turn a client goal tab into a list of structured tactics. Tabs drift in layout
(compare the Template vs Green Shield vs ECH), so **never hardcode row numbers** — anchor on headers.

## 1. Read

One call: `GOOGLESHEETS_BATCH_GET <Tab>!A1:Z<rowCount>` (get `<rowCount>` from
`GOOGLESHEETS_GET_SPREADSHEET_INFO` grid props, or read a generous `A1:Z200`).

Tab shape: row 1 = full client name; rows with `Business Goal:` / `Engagement Goal:` in col A;
then repeating **Campaign** blocks. Each block: a row with `Campaign #N` in col A, a
`Campaign Goal:` row, then a **tactics table**.

## 2. Locate tactic tables (drift-proof)

Walk rows top to bottom, tracking `current_campaign` = the most recent col-A cell matching
`/^Campaign\s*#\s*\d+/i` (also capture the campaign-goal description text in the row(s) under it).

A **tactics table** begins at any row whose first five cells, lower-cased and trimmed, equal:
`tactic`, `status`, `goal`, `cadence`, `benchmark`. (Col F header is `Results`, col G `Historical Notes`,
col H literally `Practioner` — a real misspelling; match tolerantly.)

The table body runs from the next row until: a blank col-A cell **and** blank col-C, OR a new
`Campaign #N` row, OR another `Tactic/Status/...` header, OR end of grid.

**Skip a `Campaign #N` header that is not followed by a tactics table** (Green Shield has a stray
duplicate "Campaign #4" — ignore the empty one).

Record each tactic with its **absolute row index** `r` and its `current_campaign`.

## 3. Classify channel — goal-text prefix OVERRIDES the Tactic column

Channel = **context** (paid vs organic, from the Tactic cell) × **platform** (from the Goal text).
The Goal-text platform overrides the Tactic cell *within* its context — real rows put the platform
inside the Goal while the Tactic says `Paid Media` (e.g. `Paid Media | "Google Ads: 2,000 clicks"`,
`"Meta: 6,000 link clicks"`). The same "Meta" keyword means **paid** under a Paid/Meta Ads tactic but
**organic (Pages)** under an Organic Social tactic — context decides the source.

1. **Context — from the Tactic cell:** `Organic Social` → ORGANIC · `Meta Ads`/`Google Ads`/`Paid Media`/`OTT` → PAID ·
   `SEO` → SEO · `Other` → OTHER.
2. **Platform — from the Goal text (else the Tactic cell):** `google ads`/`g-?ads` → Google ·
   `meta`/`facebook`/`fb` (and not google) → Meta/Facebook · `instagram`/` ig ` → Instagram ·
   `pinterest`→Pinterest · `youtube`→YouTube · `ott`→OTT · `callrail`/`phone call`/`form fill`/`form submission`→CallRail.
3. **Map (context, platform) → source:**
   - ORGANIC + Meta/Facebook → **`pages`** (`FACEBOOK_GET_PAGE_INSIGHTS`, Page ID from registry col M) — **AUTO**
   - ORGANIC + Instagram → `instagram` → **BLOCKED** (IG toolkit not connected)
   - ORGANIC + Pinterest / YouTube → **BLOCKED** (no connector)
   - PAID + Meta (or `Meta Ads` tactic) → **`meta`** (Ads MCP)
   - PAID + Google (or `Google Ads` tactic) → `google_ads` → **BLOCKED** (Phase 5)
   - PAID + OTT → **BLOCKED**
   - PAID + no platform keyword (`Paid Media` ambiguous): sessions metric → GA4 paid channel groups; else `NEEDS_MAPPING`
   - SEO → GA4 `Organic Search` proxy (annotate) · CallRail keywords / MQL "forms or calls" → `callrail` · `Other` → `NEEDS_MAPPING`

## 3b. CallRail company routing — multi-brand clients

Some client tabs cover several brands, each its own CallRail company, with goals written
**`Brand: <goal>`** (real example — Hatton: `"Hatton Wake: 15 MQLs"` and `"Nebar: 15 MQLs"`, two
distinct CallRail companies under one client). When registry col G holds a **brand-map**
(`Brand=COM…; Brand2=COM…`) instead of a bare `COM…`:
1. Take the text **before the first `:`** in the Goal as the `brand` token (trim).
2. Match it case-insensitively (substring-tolerant) against the brand-map keys → that brand's `company_id`.
3. No prefix / no match → if the map has exactly one entry, use it; else `NEEDS_MAPPING` (note it).

Single-company clients: col G is a bare `COM…` and every CallRail tactic uses it. The resolved
`company_id` is what `callrail_get_call_summary` / `callrail_get_form_summary` is called with.
(Caution: a CallRail company named like another client may belong to a *different* client's brand —
e.g. "Nebar" is Hatton's, not the "Nectar" tab. Trust the registry mapping, not name similarity.)

## 4. Extract metric — ordered regex, first match wins

Order matters (longer/more-specific first):
`link click`→link_clicks · `cost per (mql|lead)|cpl|cpa`→cost_per_lead · `ctr|click-through`→ctr ·
`cpc`→cpc · `cpm`→cpm · `impression`→impressions · `clicks?`→clicks · `mql`→mqls ·
`form (fill|submission)`→forms · `phone call|calls?`→calls · `lead`→leads · `session|visitor`→sessions ·
`new .*user|users?`→users · `engagement|engaged`→engagement · `follower`→followers · `roas`→roas ·
`reach`→reach · `frequency`→frequency · `video|thruplay|views?`→video_views · `spend|budget`→spend.

Then look up `(channel, metric)` in the metric catalog to get `{source, api_metric, direction, coverage}`.
No catalog match → `NEEDS_MAPPING`.

## 5. Parse the Benchmark target (col E; fall back to numbers in the Goal text)

| Raw Benchmark | → target | unit |
|---|---|---|
| `59`, `2,000`, `500,000` | 59 / 2000 / 500000 | int |
| `500k` (often only in Goal text) | 500000 | int |
| `1.50%`, `1.00%` | 1.50 / 1.00 | % |
| `$95 per MQL`, `$95` | 95 | $ |
| `7,043 (past 2 months average)`, `7,688 (June)` | 7043 / 7688 + provenance | int |
| `N/A`, blank | None → status "No Data"/"Manual" | — |

Rules: strip `,`; expand `k`→×1e3, `M`→×1e6 (read shorthand from the Goal text when Benchmark is
short/blank, e.g. "500k Monthly Impressions"); detect `%`/`$` from either the Benchmark or Goal text;
capture any parenthetical as `provenance`; strip text before/after `per` for cost goals.

**Relative goals** — `"N% increase in monthly X"` (Benchmark holds the baseline, e.g. `43,310`):
`target = baseline * (1 + N/100)`. Store both; display as "43,743 (baseline 43,310 +1%)".
(Still BLOCKED if the underlying metric is out of scope, e.g. Pinterest.)

## 6. Emit

For each tactic emit:
`{campaign, tactic_label, channel, metric, api_metric, source, direction, target, unit, provenance,
coverage, row_index, manual_status (col B), manual_results (col F)}`.

`coverage ∈ {AUTO, BLOCKED, NEEDS_MAPPING}`. Only AUTO rows get a connector fetch; the others go
to the dashboard as grey "No Data" with a Note explaining why (out of scope / needs mapping).
