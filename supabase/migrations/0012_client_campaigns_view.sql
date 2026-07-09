-- 0012: per-campaign breakdown for the console (paid sources).
-- Rolls metrics_daily up to (client, source, account, campaign) for each account's
-- latest month, so the console can list the campaigns actually running plus a total.
-- entity<>'' filters out the account-level rate rows (ctr/cpc/reach/cpl live at
-- entity='' and are NOT campaigns). Counts are additive → sums equal the platform's
-- own campaign/account totals.
create or replace view public.v_client_campaigns
with (security_invoker = on) as
with base as (
  select m.client_id, m.source, m.account_ext_id, m.entity as campaign,
    date_trunc('month', m.metric_date)::date as month_start,
    sum(m.value) filter (where m.metric_name = 'spend')       as spend,
    sum(m.value) filter (where m.metric_name = 'impressions') as impressions,
    sum(m.value) filter (where m.metric_name = 'clicks')      as clicks,
    sum(m.value) filter (where m.metric_name = 'leads')       as leads,
    sum(m.value) filter (where m.metric_name = 'conversions') as conversions,
    count(distinct m.metric_date)                             as days
  from public.metrics_daily m
  where m.source in ('meta', 'google_ads') and m.entity <> ''
  group by m.client_id, m.source, m.account_ext_id, m.entity,
           date_trunc('month', m.metric_date)
),
latest as (
  select *, row_number() over (
    partition by client_id, source, account_ext_id order by month_start desc
  ) as rn
  from base
)
select
  c.slug,
  l.client_id,
  l.source,
  l.account_ext_id,
  coalesce(cs.params->>'brand', cs.params->>'state', '')            as brand,
  coalesce(cs.params->>'label', nullif(l.account_ext_id, ''))       as account_label,
  l.campaign,
  l.month_start,
  l.days,
  l.spend, l.impressions, l.clicks, l.leads, l.conversions
from latest l
join public.clients c on c.id = l.client_id
left join public.client_sources cs
  on cs.client_id = l.client_id
 and cs.source = l.source
 -- Google Ads account_ext_id is a dashed CID; client_sources stores digits → normalize
 and regexp_replace(cs.external_id, '\D', '', 'g') = regexp_replace(l.account_ext_id, '\D', '', 'g')
where l.rn = 1;

comment on view public.v_client_campaigns is
  'Latest-month campaign breakdown per (client, source, account) for paid sources — the campaigns running + additive metrics that total to the account.';
