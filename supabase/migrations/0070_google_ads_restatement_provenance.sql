-- 0070_google_ads_restatement_provenance.sql — applied live 2026-09-21. The daily run now re-pulls a
-- trailing 30-day Google Ads window instead of yesterday alone (GADS_RESTATE_DAYS in
-- orchestrator/run.mjs), because Google credits a conversion to the date of the CLICK and keeps
-- adding to that date across the conversion window. Verified on BHS / TOF_demand_maxclicks_AL:
-- re-pulling 2026-09-01..09-20 moved conversions 866.69 → 1727.33 (Google's own figure) while
-- clicks moved 2863 → 2862 and impressions 87589 → 87587 — only conversions restate materially.
-- This row is what the console shows in the provenance popover, so it has to say so.
update public.source_methods
set method = 'Pulled directly from the Google Ads API (developer token, Explorer access) for every '
           || 'account the Deksia Google user can read — MCC accounts via the MCC, directly-granted '
           || 'accounts as themselves. Ad-group counts, campaign rates as Google computes them, '
           || 'conversion actions by name. Conversions are credited by Google to the date of the click '
           || 'and keep accruing there for weeks, so each day is re-read for 30 days and restated to '
           || 'whatever Google reports at the time — the figure always matches the platform, and a day '
           || 'older than 30 days is final unless it is re-pulled.',
    cadence = 'GitHub Actions, daily ~7:00 AM ET, trailing 30 days (restatement window — one query '
           || 'covers the range, so it costs no extra quota); backfills via the platform queue '
           || '(≤3 months/day by quota)'
where source = 'google_ads';
