# Metric Catalog, Normalizer & Evaluation

Maps each recurring goal phrase to `{source, api_metric, direction, unit, coverage}`, then
defines how to normalize raw values and compute attainment + status.

`Dir`: **HIB** = higher-is-better, **LIB** = lower-is-better, **ctx** = goal-dependent.
`Cov`: **AUTO** = fillable today · **AUTO\*** = fillable with a caveat (annotate) · **BLOCKED** = needs a connector not in scope.

## Catalog

| ID | Goal phrase (examples) | Source | API metric / derivation | Dir | Unit | Cov |
|---|---|---|---|---|---|---|
| M1 | "N Meta Leads a month", "N meta forms" | Meta | `lead` | HIB | int | AUTO |
| M2 | "N Meta link clicks", "link clicks" | Meta | `actions:link_click` | HIB | int | AUTO |
| M3 | "N clicks" (Meta context) | Meta | `clicks` | HIB | int | AUTO |
| M4 | "N% Monthly CTR" (Meta) | Meta | `ctr` | HIB | % | AUTO |
| M5 | link-click CTR | Meta | `actions:link_click / impressions` (derived) | HIB | % | AUTO |
| M6 | "Nk/N Monthly Impressions" (Meta) | Meta | `impressions` | HIB | int | AUTO |
| M7 | "$N Cost per MQL/lead" (Meta) | Meta | `cost_per_action_type:lead` ¹ | LIB | $ | AUTO |
| M8 | CPC | Meta | `cpc` | LIB | $ | AUTO |
| M9 | cost per link click | Meta | `cost_per_link_click` | LIB | $ | AUTO |
| M10 | CPM | Meta | `cpm` | LIB | $ | AUTO |
| M11 | spend / budget pacing | Meta | `amount_spent` | ctx | $ | AUTO |
| M12 | reach / frequency | Meta | `reach` / `frequency` | HIB/ctx | int/float | AUTO |
| M13 | ROAS | Meta | `purchase_roas` | HIB | ratio | AUTO (commerce only) |
| M14 | purchases | Meta | `actions:omni_purchase` | HIB | int | AUTO (commerce only) |
| M15 | video views | Meta | `video_thruplay_watched_actions` | HIB | int | AUTO |
| G1 | "N monthly website sessions/visitors" | GA4 | `sessions` | HIB | int | AUTO |
| G2 | users / new users | GA4 | `totalUsers` / `newUsers` | HIB | int | AUTO |
| G3 | engaged sessions / engagement rate | GA4 | `engagedSessions` / `engagementRate` | HIB | int/% | AUTO |
| G4 | pageviews | GA4 | `screenPageViews` | HIB | int | AUTO |
| G5 | conversions / key events | GA4 | `keyEvents` (fallback `conversions`) ² | HIB | int | AUTO |
| G6 | "N SEO clicks", "qualified leads from Organic search" | GA4 | `sessions` filter `sessionDefaultChannelGroup="Organic Search"` (PROXY) | HIB | int | AUTO\* |
| G7 | "N Paid Media sessions" | GA4 | `sessions` filter Paid Social/Paid Search/Display | HIB | int | AUTO |
| C1 | "N phone calls" | CallRail | `call_summary.total_results.total_calls` | HIB | int | AUTO |
| C2 | qualified / good-lead calls | CallRail | `call_summary.total_results.leads` | HIB | int | AUTO (lead scoring) |
| C3 | "N form fills/submissions" | CallRail | `form_summary.total_results.total_forms` | HIB | int | AUTO |
| C4 | "N MQLs a month (form fills or phone calls)" | CallRail | loose: `total_calls + total_forms`; strict: `call.leads + form.leads` | HIB | int | AUTO |
| C5 | "$N Cost per MQL" (blended) | Meta+CR | `Meta amount_spent / MQLs` (Meta spend ONLY) | LIB | $ | AUTO\* |
| C6 | first-time callers | CallRail | `call_summary.total_results.first_time_callers` | HIB | int | AUTO |
| P1 | "N new Meta/FB followers per month" | Pages | `page_daily_follows_unique` (sum); net = follows − `page_daily_unfollows_unique` | HIB | int | AUTO |
| P2 | total followers / fan count | Pages | `page_follows` (or `fan_count`/`followers_count` from list) | HIB | int | AUTO |
| P3 | "1% increase in monthly Meta reach/impressions" (organic) | Pages | `page_media_view` ³ | HIB | int | AUTO |
| P4 | organic post engagement | Pages | `page_post_engagements` | HIB | int | AUTO |
| P5 | organic video views | Pages | `page_video_views` | HIB | int | AUTO |
| P6 | "N Meta link clicks" (**organic**) | Pages | no first-class Page metric — post-level only (`FACEBOOK_GET_POST_INSIGHTS`) | HIB | int | AUTO\* (partial) |
| X1 | "N clicks a month" **(Google Ads)** | — | needs Google Ads | — | — | BLOCKED |
| X2 | "N% CTR" **(Google Ads)** | — | needs Google Ads | — | — | BLOCKED |
| X3 | MQLs / conversions attributed to **Google Ads** | — | GA4 gives channel sessions, not Google conversions | — | — | BLOCKED |
| X4 | Cost per MQL **incl. Google spend** | — | no Google Ads spend | — | — | BLOCKED |
| X5 | Instagram organic (followers / reach / engagement) | — | needs the Composio `instagram` toolkit connected (IG Business acct) | — | — | BLOCKED (connect IG) |
| X6 | Pinterest impressions | — | no connector | — | — | BLOCKED |
| X7 | YouTube views | — | no connector | — | — | BLOCKED |
| X8 | OTT impressions | — | no connector | — | — | BLOCKED |

¹ Request bare `cost_per_action_type` (or pair with `lead`); the per-lead value returns under the
key `cost_per_action_type:lead`. Requesting that exact key directly is rejected by the API.
² Resolve `keyEvents` vs legacy `conversions` per property via `GOOGLE_ANALYTICS_GET_METADATA`; store the resolved name.
³ **Pages** source = Composio `facebook` toolkit (`FACEBOOK_GET_PAGE_INSIGHTS`, `page_id` from registry col M, `period=day`,
`since`/`until` window, metrics `page_follows,page_daily_follows_unique,page_daily_unfollows_unique,page_media_view,page_post_engagements,page_video_views`).
Deprecated names auto-map (`page_impressions`→`page_media_view`, `page_fans`→`page_follows`). Empty `{}` = no data, not 0. Instagram organic needs the
separate `instagram` toolkit (not connected). Only Facebook Pages here — Pinterest/YouTube/OTT have no connector.

## Meta value normalizer (mandatory before any compare)

Every Meta field comes back as a **formatted display string**. `to_number(s)`:
- return `None` if `s` is `""`, `"Not available"`, or null;
- strip nbsp/` `, the literal `USD`, `$`, `%`, and thousands `,`;
- parse the remainder as a float.

Verified live (Green Shield, May 2026): `"1,843,604"`→1843604 · `"1.71%"`→1.71 · `"$7,852.95 USD"`→7852.95.

## MQL computation

Per the client's **MQL Definition** (registry col J):
- `loose` (default): `MQLs = CallRail total_calls + CallRail total_forms` (+ Meta `lead` if the goal
  text scopes MQLs to Meta forms specifically).
- `strict`: `MQLs = call_summary.leads + form_summary.leads` (requires CallRail lead scoring enabled;
  if disabled, fall back to `loose` and flag it in the Note).
- Blended **Cost per MQL** = `Meta amount_spent / MQLs`. **Meta spend only** until Google Ads (Phase 5);
  annotate every CPL cell with "Meta spend only".

## Attainment + status

```
HIB:  attainment = actual / target          (most metrics)
LIB:  attainment = target / actual          (cost-per-MQL, CPC, CPM, cost-per-link-click)
None: actual or target missing / BLOCKED → Status "Awaiting"
```

**Mid-month proration** (on-demand runs inside the current month):
`expected_to_date = target * (run_day / days_in_month)` (linear; flag the assumption in the Note).
Compare `actual` vs `expected_to_date` for status; also store full-month attainment in the Results text.
The scheduled run on the 2nd uses `date_preset=last_month` → full month, **no proration**.
**Rates** (CTR, engagement rate, ROAS, frequency) are not prorated.

**Status vocabulary — matches the tracker's own** (`Tactic Status` column), so the mirror reads like the original:

| Attainment | Status (written to col B) |
|---|---|
| ≥ 100% | `On Track` |
| < 100% | `Off Track` |
| measurable-but-not-yet (no connector / source offline / out of scope) | `Awaiting` |

`ON_TRACK_MIN = 1.00` is a config constant. Optional finer band (off by default to stay faithful to the
tracker): `Slightly Behind` for 0.85–<1.00. Never compute status for rows whose source Status is `Lead`;
copy those through unchanged. `Awaiting` rows always carry a reason in Results so a measurement gap never
reads as a failing client.

### Worked example — Green Shield, run 2026-06-18 (month-to-date, prorated)
- Leads: target 59, actual 16, expected-to-date 33.4 → 48% → **Off Track** (full-month math would falsely read 27%).
- Cost/lead: target $95, actual $346.67, LIB → 27% → **Off Track**.
- Impressions: actual 1,022,128 vs paced 283,333 → 361% → **On Track**.
- CTR: 1.86% vs 1.00% (rate, no proration) → 186% → **On Track**.
