-- 0023 (applied live 2026-08-05): data-integrity sentinel.
-- data_gaps(p_days) finds (source, day) pairs with zero rows across the book in
-- the trailing window (sources already live before the window). integrity_checks
-- logs each nightly verdict: ok / attention (google_ads gaps - push-only, needs
-- MCC backfill script) / issues (re-pull failures). run.mjs sweeps healable gaps
-- automatically by re-pulling exactly the missing days (idempotent); a day that
-- re-pulls cleanly but stays empty is recorded as verified-empty, not a gap.
-- Index metrics_daily(source, metric_date) supports the probe.
-- Full defs via Supabase migration `integrity_sentinel`.
select 1; -- marker
