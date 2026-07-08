-- 0009: present platform data exactly as the platform reports it.
-- GA4 reports users/new_users PER CHANNEL (those raw rows are faithful and stay).
-- But summing unique-user counts across channels/days produces a number GA4 itself
-- never shows (a user in 2 channels counts twice). v_client_report therefore stops
-- publishing those computed sums. Additive metrics (sessions, key_events, spend, ...)
-- are unaffected — their sums equal the platform's own totals.
create or replace view public.v_client_report
with (security_invoker = on) as
with ranked as (
  select mm.*,
    row_number() over (
      partition by mm.client_id, mm.source, mm.metric_name
      order by mm.month_start desc
    ) as rn
  from public.metrics_monthly mm
  -- unique-people counts are non-additive: a cross-channel/cross-day sum is a
  -- fabricated number. Exclude from reporting rather than present it as truth.
  where not (mm.source = 'ga4' and mm.metric_name in ('users', 'new_users'))
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
  'Per-client latest-month vs previous-month metric values for the console. Platform-faithful: excludes cross-channel user sums (GA4 users/new_users) that the platform itself never reports.';
