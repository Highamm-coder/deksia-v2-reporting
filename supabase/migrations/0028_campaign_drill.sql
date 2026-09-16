-- 0028 (applied live 2026-08-05): v_client_campaign_drill — campaign children at the
-- finest grain each platform provides: Meta 'ad set › ad' (split into ad_set/ad
-- columns), Google Ads ad group (PMax rows carry the channel type since PMax has no
-- ad groups). Counts only — rates stay at the grain the platform computes them.
-- Reads private.mv_metrics_monthly_dim; granted to authenticated.
select 1; -- marker
