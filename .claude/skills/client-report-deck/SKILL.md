---
name: client-report-deck
description: Build a client's monthly performance report as a Slate deck and convert it to Google Slides. Args: <client-slug> [YYYY-MM]. Pulls everything from the reporting platform's report_pack() — never hand-assembles data.
---

# Client report deck

Turn one month of a client's platform data into a Deksia-branded Google Slides report.
Data comes from **one call** — `report_pack(slug, month)` on the Supabase reporting
project (`ykxauddrsnuwkvimkdhw`) — never from ad-hoc queries against tables or views.

## Steps

1. **Resolve arguments.** First arg = client slug (match case-insensitively against
   `select slug from clients`). Optional second arg = month `YYYY-MM`. If no month
   given, default to the **last full month** (if the pack for the latest month says
   `"mtd": true`, use the month before instead — client reports should be full months
   unless the user explicitly asks for MTD).

2. **Fetch the pack** via the Supabase MCP:
   ```sql
   select report_pack('<slug>', '<YYYY-MM>');
   ```
   The JSON contains: `metrics` (per source/account/metric with prev-month value +
   pct_change), `campaigns` (per campaign with spend/impressions/clicks/results),
   `computed` (Deksia formulas with numerator/denominator and the actual month math),
   `goals` (status vs target), `monthly_series` (client-level trend by metric), and
   `provenance` (source → account → method → coverage → last pulled).

3. **Compose the deck brief** for the Slate skill. Slide outline:
   - **Cover** — client name, "Monthly Performance Report — <Month Year>", Deksia.
   - **Executive summary** — the priority metrics (spend, leads, MQLs, qualified,
     CPL, CTR, impressions, calls) as stat tiles with MoM deltas; pull each from
     `metrics` / `computed`.
   - **Trend** — spend and leads/MQLs over the available months (`monthly_series`).
   - **One slide per paid platform** (google_ads, meta): account totals + top
     campaigns by spend from `campaigns` (include the TOTAL row).
   - **Organic & web** — GA4 sessions/engaged/key events by month; Facebook Pages
     follows/engagement if present.
   - **Leads** — CallRail calls/forms/MQLs/qualified with MoM.
   - **Goals** — each goal with status pill wording (on track / at risk / achieved).
   - **Appendix: data sources** — the `provenance` array verbatim (source, account,
     method, coverage, last pulled). Every Deksia report ships with its lineage.

4. **Data integrity rules (non-negotiable):**
   - Use values **verbatim** from the pack. Never re-derive rates (no computing CTR
     from clicks/impressions — use the platform-reported rate rows), never average
     rates across accounts, never fill gaps.
   - Metrics from `computed` must be labeled "Deksia-computed" with the formula shown
     (e.g. "Blended CPL = (Meta + Google Ads spend) ÷ (Meta leads + CallRail MQLs)").
   - If the pack has `"mtd": true`, every slide header must carry "Month to date —
     through N days".
   - A platform absent from the pack gets one honest line ("No <platform> data for
     <month> — see data sources"), not silence.

5. **Build the deck**: invoke the `slate-v3-beta` skill with the composed brief.
   Audience: the client's stakeholders (plain-English, no internal jargon). Accent:
   Deksia violet `#6d52e0`. 16:9.

6. **Convert to Google Slides**: the user invoking this skill IS the explicit ask —
   tell slate-v3-beta to convert the finished deck to Google Slides (hybrid PPTX →
   Drive) and return the Slides link.

7. **Deliver**: the Slides link + a 3-bullet summary of the month's headline story
   (biggest mover, goal status, any data caveat from provenance).
