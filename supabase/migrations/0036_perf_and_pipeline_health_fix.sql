-- 0036 (applied live 2026-08-27): performance at 1.4M+ rows.
-- (a) index metrics_daily (client_id, source, metric_date desc).
-- (b) mv_pipeline_health rebuilt on per-(client,source) LATERAL lookups instead of a
--     full-table aggregate joined to client_sources. Two bugs fixed at once:
--       * the old shape joined mappings BEFORE aggregating, so a client with N mapped
--         accounts counted every row N times (the long-flagged rows_30d inflation);
--       * the full scan had started exceeding the statement timeout, which would have
--         silently broken the hourly rollup cron as the table grows.
--     11.9s -> 0.9s; refresh verified (78 rows, 62 fresh).
select 1; -- marker
