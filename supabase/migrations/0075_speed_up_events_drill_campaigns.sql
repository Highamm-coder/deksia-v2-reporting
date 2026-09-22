-- 0075_speed_up_events_drill_campaigns.sql — applied live 2026-09-22.
--
-- The rest of the client page's views, carrying the same two defects fixed in 0074:
--
--   1. client_sources was joined BEFORE aggregating, so a lookup whose only job is to fetch a
--      brand/label ran once per pre-aggregation row instead of once per output row.
--   2. `clients` was joined AFTER aggregating, so a caller's `where slug = …` could not push
--      down — every page load aggregated all 29 clients and then threw 28 of them away.
--
-- Measured for Contingent (the heaviest client):
--   v_client_campaign_drill   259 ms ->  85 ms
--   v_client_campaigns_all    209 ms -> 119 ms
--   v_client_events            18 ms ->   8 ms   (333 ms on a cold cache before)
--
-- All three were verified byte-identical before the swap: same column list in the same order,
-- same row counts (886, 6264, 1836), and EXCEPT ALL in BOTH directions returned zero rows.
--
-- The client_sources joins also become laterals with `limit 1`. No client has two mappings
-- matching one account id today (checked: zero), so this changes nothing now — it removes the
-- latent row-multiplication if one is ever added.
--
-- A (client_id, source, account_ext_id, entity, month_start) index was tried for the campaign
-- grouping and the planner would not take it — mv_mmd_rollup from 0074 already carries the
-- breakout filter, which is worth more than the sort order. Left out rather than left unused.

create or replace view public.v_client_events as
with agg as (
  select c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity as campaign,
         mv.qualifier as event, mv.month_start,
         sum(mv.value) as conversions, max(mv.days) as days
  from private.mv_metrics_monthly_dim mv
  join public.clients c on c.id = mv.client_id
  where mv.metric_name = 'conversion_action'
  group by c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity, mv.qualifier, mv.month_start
)
select a.slug, a.client_id, a.source, a.account_ext_id,
       coalesce(cs.params ->> 'brand', cs.params ->> 'state', '') as brand,
       coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(a.account_ext_id, '')) as account_label,
       a.campaign, a.event, a.month_start, a.conversions, a.days
from agg a
left join lateral (select cs.params from public.client_sources cs
  where cs.client_id = a.client_id and cs.source = a.source
    and public.same_account_id(cs.external_id, a.account_ext_id) limit 1) cs on true;

create or replace view public.v_client_campaign_drill as
with agg as (
  select c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity as campaign,
         mv.qualifier as child, mv.month_start,
         max(mv.days) as days,
         sum(mv.value) filter (where mv.metric_name = 'spend') as spend,
         sum(mv.value) filter (where mv.metric_name = 'impressions') as impressions,
         sum(mv.value) filter (where mv.metric_name = 'clicks') as clicks,
         sum(mv.value) filter (where mv.metric_name = 'leads') as leads,
         sum(mv.value) filter (where mv.metric_name = 'conversions') as conversions
  from private.mv_metrics_monthly_dim mv
  join public.clients c on c.id = mv.client_id
  -- ad: rows are kept ON PURPOSE here; this is the drill-down (see 0071)
  where mv.source = any (array['meta','google_ads']) and mv.entity <> '' and mv.qualifier <> ''
    and (mv.qualifier like 'ad:%' or not public.is_breakout(mv.qualifier))
    and mv.metric_name = any (array['spend','impressions','clicks','leads','conversions'])
  group by c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity, mv.qualifier, mv.month_start
)
select a.slug, a.client_id, a.source, a.account_ext_id,
       coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(a.account_ext_id, '')) as account_label,
       a.campaign, a.child,
       case when a.child like 'ad:%' then split_part(substring(a.child from 4), ' › ', 1)
            else split_part(a.child, ' › ', 1) end as ad_set,
       case when a.child like 'ad:%' then nullif(split_part(substring(a.child from 4), ' › ', 2), '')
            else nullif(split_part(a.child, ' › ', 2), '') end as ad,
       a.child like 'ad:%' as is_ad_level,
       a.month_start, a.days, a.spend, a.impressions, a.clicks, a.leads, a.conversions
from agg a
left join lateral (select cs.params from public.client_sources cs
  where cs.client_id = a.client_id and cs.source = a.source
    and public.same_account_id(cs.external_id, a.account_ext_id) limit 1) cs on true;

-- campaigns_all already aggregated first; what it lacked was the pushdown. `clients` now joins
-- inside BOTH cte's — the rates cte is reached only through the join key, so filtering counts
-- alone would still have aggregated every client's rate rows.
create or replace view public.v_client_campaigns_all as
with counts as (
  select c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity as campaign, mv.month_start,
     max(mv.days) as days,
     sum(mv.value) filter (where mv.metric_name = 'spend') as spend,
     sum(mv.value) filter (where mv.metric_name = 'impressions') as impressions,
     sum(mv.value) filter (where mv.metric_name = 'clicks') as clicks,
     sum(mv.value) filter (where mv.metric_name = 'leads') as leads,
     sum(mv.value) filter (where mv.metric_name = 'conversions') as conversions,
     sum(mv.value) filter (where mv.metric_name = 'conversions_value') as conversions_value
  from private.mv_metrics_monthly_dim mv
  join public.clients c on c.id = mv.client_id
  where mv.source = any (array['meta','google_ads']) and mv.entity <> ''
    and not public.is_breakout(mv.qualifier)
  group by c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity, mv.month_start
), rates as (
  select c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity as campaign, mv.month_start,
     avg(mv.value) filter (where mv.metric_name = 'ctr') as ctr,
     avg(mv.value) filter (where mv.metric_name = 'cpc') as cpc,
     avg(mv.value) filter (where mv.metric_name = 'cpm') as cpm,
     avg(mv.value) filter (where mv.metric_name = 'frequency') as frequency,
     sum(mv.value) filter (where mv.metric_name = 'reach') as reach,
     avg(mv.value) filter (where mv.metric_name = 'cost_per_lead') as cost_per_lead,
     avg(mv.value) filter (where mv.metric_name = 'cost_per_conversion') as cost_per_conversion,
     avg(mv.value) filter (where mv.metric_name = 'conversion_rate') as conversion_rate,
     avg(mv.value) filter (where mv.metric_name = 'impression_share') as impression_share,
     avg(mv.value) filter (where mv.metric_name = 'lost_is_budget') as lost_is_budget,
     avg(mv.value) filter (where mv.metric_name = 'lost_is_rank') as lost_is_rank,
     avg(mv.value) filter (where mv.metric_name = 'top_impression_pct') as top_impression_pct,
     sum(mv.value) filter (where mv.metric_name = 'video_views') as video_views,
     avg(mv.value) filter (where mv.metric_name = 'video_view_rate') as video_view_rate,
     sum(mv.value) filter (where mv.metric_name = 'phone_calls') as phone_calls,
     sum(mv.value) filter (where mv.metric_name = 'thruplays') as thruplays,
     avg(mv.value) filter (where mv.metric_name = 'link_ctr') as link_ctr,
     avg(mv.value) filter (where mv.metric_name = 'cost_per_link_click') as cost_per_link_click
  from private.mv_metrics_monthly_dim mv
  join public.clients c on c.id = mv.client_id
  where mv.qualifier = 'rate'          -- rates are averaged, never summed; see 0014
  group by c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.entity, mv.month_start
)
select k.slug, k.client_id, k.source, k.account_ext_id,
  coalesce(cs.params ->> 'brand', cs.params ->> 'state', '') as brand,
  coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(k.account_ext_id, '')) as account_label,
  k.campaign, k.month_start, k.days, k.spend, k.impressions, k.clicks, k.leads, k.conversions,
  k.conversions_value,
  r.ctr, r.cpc, r.cpm, r.frequency, r.reach, r.cost_per_lead, r.cost_per_conversion, r.conversion_rate,
  r.impression_share, r.lost_is_budget, r.lost_is_rank, r.top_impression_pct, r.video_views,
  r.video_view_rate, r.phone_calls, r.thruplays, r.link_ctr, r.cost_per_link_click
from counts k
left join rates r on r.slug = k.slug and r.source = k.source and r.account_ext_id = k.account_ext_id
  and r.campaign = k.campaign and r.month_start = k.month_start
left join lateral (select cs.params from public.client_sources cs
  where cs.client_id = k.client_id and cs.source = k.source
    and public.same_account_id(cs.external_id, k.account_ext_id) limit 1) cs on true;

-- CREATE OR REPLACE VIEW drops security_invoker; it has to be re-asserted every time (see 0065)
alter view public.v_client_events         set (security_invoker = true);
alter view public.v_client_campaign_drill set (security_invoker = true);
alter view public.v_client_campaigns_all  set (security_invoker = true);
grant select on public.v_client_events, public.v_client_campaign_drill, public.v_client_campaigns_all
  to authenticated, service_role;

drop view if exists public.zz_events;
drop view if exists public.zz_drill;
drop view if exists public.zz_campaigns;
