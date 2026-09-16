-- 0021 (applied live 2026-08-03): v_campaign_types — the campaign coverage audit.
-- Per (client, account, campaign): advertising channel type (scripts now stamp
-- meta.ctype on every Google Ads row; campaign-grain catch rows carry it in the
-- qualifier), capture grain ('ad group (finest)' / 'campaign level (no ad groups)'
-- / explicit BLIND SPOT for conversions-only campaigns), coverage window, totals.
-- Trust rule: a campaign whose spend we cannot see must SAY SO, not show $0.
select 1; -- marker
