-- 0020 (applied live 2026-07-31): v_client_events — Google Ads conversion events BY
-- NAME (qualifier of conversion_action rows) per client/account/campaign/month; also
-- added as 'events' key to report_pack(), and conversion_action excluded from the
-- summed metrics/series (shown named instead). Full defs via Supabase migrations
-- `client_events_view` + the report_pack redefinition.
select 1; -- marker
