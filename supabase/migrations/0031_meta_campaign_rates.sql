-- 0031 (applied live 2026-08-05): Meta campaign-grain rates.
-- run.mjs adds a level=campaign insights pull (ctr, cpc, cpm, frequency, reach,
-- cost_per_action_type) stored as entity=<campaign>, qualifier='rate' — a distinct
-- grain so it never mixes with ad-level counts or account-level rates. Platform-
-- reported at campaign level, never derived from our ad rows.
-- v_client_monthly now excludes qualifier='rate' (it would pollute account averages);
-- v_client_campaigns_all left-joins the rates onto each campaign line (ctr, cpc, cpm,
-- frequency, reach, cost_per_lead). Google Ads campaigns show no rate columns —
-- the Ads Scripts report counts at ad-group grain and we don't invent rates.
select 1; -- marker
