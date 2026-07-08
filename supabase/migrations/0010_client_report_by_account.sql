-- 0010: per-account/brand reporting grain for the console.
-- v_client_report consolidates a client's metrics across all accounts — wrong for
-- multi-brand clients (Contingent = Every Child OR/AR/TN, Hatton = Wake/Nebar, ...).
-- This view keeps the same latest-month vs previous-month shape but broken out per
-- (source, account_ext_id), with the human label/brand joined from client_sources.
-- Aggregation is agg-aware per metric (counts summed, rates averaged), and GA4
-- users/new_users stay excluded (cross-channel sums GA4 never reports — see 0009).

create or replace view public.v_client_report_detail
with (security_invoker = on) as
with monthly as (
  select m.client_id, m.source, m.account_ext_id, m.metric_name,
    date_trunc('month', m.metric_date)::date as month_start,
    case coalesce(d.agg, 'sum')
      when 'avg'  then avg(m.value)
      when 'last' then (array_agg(m.value order by m.metric_date desc))[1]
      when 'max'  then max(m.value)
      when 'min'  then min(m.value)
      else sum(m.value)
    end as value,
    coalesce(d.agg, 'sum') as agg,
    count(distinct m.metric_date) as day_count
  from public.metrics_daily m
  left join public.metric_definitions d
    on d.source = m.source and d.metric_name = m.metric_name
  where not (m.source = 'ga4' and m.metric_name in ('users', 'new_users'))
  group by m.client_id, m.source, m.account_ext_id, m.metric_name,
           date_trunc('month', m.metric_date), coalesce(d.agg, 'sum')
),
ranked as (
  select *,
    row_number() over (
      partition by client_id, source, account_ext_id, metric_name
      order by month_start desc
    ) as rn
  from monthly
)
select
  c.slug,
  cur.client_id,
  cur.source,
  cur.account_ext_id,
  coalesce(cs.params->>'brand', cs.params->>'state', '') as brand,
  coalesce(cs.params->>'label', nullif(cur.account_ext_id, ''))   as account_label,
  cur.metric_name,
  d.unit,
  cur.agg,
  d.direction_default as direction,
  cur.month_start     as cur_month,
  cur.value           as cur_value,
  cur.day_count       as cur_days,
  prev.month_start    as prev_month,
  prev.value          as prev_value,
  prev.day_count      as prev_days,
  case
    when prev.value is not null and prev.value <> 0
      then (cur.value - prev.value) / abs(prev.value)
  end                 as pct_change
from ranked cur
join public.clients c on c.id = cur.client_id
left join ranked prev
  on prev.client_id = cur.client_id
 and prev.source = cur.source
 and prev.account_ext_id = cur.account_ext_id
 and prev.metric_name = cur.metric_name
 and prev.rn = 2
left join public.client_sources cs
  on cs.client_id = cur.client_id
 and cs.source = cur.source
 and cs.external_id = cur.account_ext_id
left join public.metric_definitions d
  on d.source = cur.source and d.metric_name = cur.metric_name
where cur.rn = 1;

comment on view public.v_client_report_detail is
  'Per (client, source, account) latest-month vs previous-month metrics with brand/label from client_sources — the granular grain behind the console client page (multi-brand clients).';
