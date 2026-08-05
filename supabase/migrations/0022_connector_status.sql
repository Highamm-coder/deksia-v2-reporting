-- 0022 (applied live 2026-08-05): connector_status — credential health, self-
-- reported by the pipeline. run.mjs asks Facebook's debug_token how long the Meta
-- token has left every run and POSTs it via the connector-status edge fn (bearer
-- ingest_token auth). Dashboard: Credentials card on /pipeline + sidebar warning
-- at <=14 days. Never hand-maintained. Full defs via Supabase migration
-- `connector_status` + edge fn supabase/functions/connector-status.
select 1; -- marker
