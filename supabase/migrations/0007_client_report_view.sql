-- 0007: per-client performance reporting view.
-- Surfaces, for every (client, source, metric): the latest month's value vs the
-- previous month's, with % change — the actual reporting numbers the console shows
-- per client. Aggregation (sum vs avg vs last/min/max) is inherited from
-- metrics_monthly, which already applies each metric_definitions.agg method, so
-- rate metrics (ctr/cpc/cpl) are averaged and counts are summed correctly.
-- day_count is carried through so the UI can flag partial months.

create or replace view public.v_client_report
with (security_invoker = on) as
with ranked as (
  select mm.*,
    row_number() over (
      partition by mm.client_id, mm.source, mm.metric_name
      order by mm.month_start desc
    ) as rn
  from public.metrics_monthly mm
)
select
  c.slug,
  cur.client_id,
  cur.source,
  cur.metric_name,
  d.unit,
  coalesce(d.agg, 'sum')       as agg,
  d.direction_default          as direction,
  d.description,
  cur.month_start              as cur_month,
  cur.value                    as cur_value,
  cur.day_count                as cur_days,
  prev.month_start             as prev_month,
  prev.value                   as prev_value,
  prev.day_count               as prev_days,
  case
    when prev.value is not null and prev.value <> 0
      then (cur.value - prev.value) / abs(prev.value)
  end                          as pct_change
from ranked cur
join public.clients c
  on c.id = cur.client_id
left join ranked prev
  on prev.client_id = cur.client_id
 and prev.source     = cur.source
 and prev.metric_name = cur.metric_name
 and prev.rn = 2
left join public.metric_definitions d
  on d.source = cur.source
 and d.metric_name = cur.metric_name
where cur.rn = 1;

comment on view public.v_client_report is
  'Per-client latest-month vs previous-month metric values (agg-aware) for the reporting console.';
