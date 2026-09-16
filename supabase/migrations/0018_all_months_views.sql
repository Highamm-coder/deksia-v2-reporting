-- 0018 (applied live 2026-07-31): month-parameterized reads for the console's time
-- axis. v_client_monthly / v_client_campaigns_all / v_client_derived_all mirror the
-- latest-month views' shapes but expose EVERY month from mv_metrics_monthly_dim;
-- the client page selects the month (?month=YYYY-MM) and pairs it with the prior
-- month in JS. Full definitions applied via Supabase migration `all_months_views`.
select 1; -- marker
