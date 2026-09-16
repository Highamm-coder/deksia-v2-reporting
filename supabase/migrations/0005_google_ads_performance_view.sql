-- Google Ads performance view: pivots tall google_ads rows to campaign grain and
-- derives rate metrics from the raw counts (correct at any rollup).
create or replace view public.v_google_ads_performance with (security_invoker = on) as
with p as (
  select client_id, account_ext_id, entity, metric_date,
    sum(value) filter (where metric_name='impressions') as impressions,
    sum(value) filter (where metric_name='clicks')      as clicks,
    sum(value) filter (where metric_name='spend')       as cost,
    sum(value) filter (where metric_name='conversions') as conversions
  from public.metrics_daily
  where source='google_ads'
  group by client_id, account_ext_id, entity, metric_date
)
select c.slug, c.name, p.account_ext_id, nullif(p.entity,'') as campaign, p.metric_date,
       p.impressions, p.clicks, p.cost, p.conversions,
       round((p.clicks      / nullif(p.impressions,0)) * 100, 2) as ctr_pct,
       round( p.cost        / nullif(p.clicks,0),            2) as cpc,
       round((p.conversions / nullif(p.clicks,0))      * 100, 2) as conv_rate_pct,
       round( p.cost        / nullif(p.conversions,0),       2) as cost_per_conv,
       round( p.conversions / nullif(p.cost,0),              4) as conv_per_dollar
from p join public.clients c on c.id = p.client_id;
