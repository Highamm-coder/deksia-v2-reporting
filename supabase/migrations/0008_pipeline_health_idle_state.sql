-- 0008: distinguish "idle" from "stale" in pipeline health.
-- Old logic marked any source without a recent row as "stale", conflating two very
-- different situations: (a) the connector is behind / broken, vs (b) the connector is
-- healthy but this account legitimately had no activity (no ad spend, no traffic, no
-- calls). Now: if the source AS A WHOLE ingested recently, a rowless account is "idle";
-- only a source whose whole connector is behind is "stale" (needs attention).
create or replace view public.v_pipeline_health
with (security_invoker = on) as
with base as (
  select c.slug, c.name, c.status as client_status, s.source,
    count(distinct s.external_id) as id_count,
    max(m.metric_date) as last_metric_date,
    max(m.ingested_at)  as last_ingested_at,
    count(m.*) filter (where m.metric_date >= ((now() at time zone 'America/New_York')::date - 30)) as rows_30d,
    count(distinct m.metric_name) as metric_count
  from clients c
  join client_sources s on s.client_id = c.id and s.active
  left join metrics_daily m on m.client_id = c.id and m.source = s.source
  where c.status = 'active'
  group by c.slug, c.name, c.status, s.source
)
select b.slug, b.name, b.client_status, b.source, b.id_count,
  b.last_metric_date, b.last_ingested_at, b.rows_30d, b.metric_count,
  case
    when b.last_ingested_at is null then 'no_data'
    when b.last_metric_date >= ((now() at time zone 'America/New_York')::date - 2) then 'fresh'
    when max(b.last_ingested_at) over (partition by b.source) >= now() - interval '2 days' then 'idle'
    else 'stale'
  end as sync_status,
  max(b.last_ingested_at) over (partition by b.source) as source_last_ingested
from base b;

comment on view public.v_pipeline_health is
  'Per client x source freshness. sync_status: fresh (recent data) | idle (connector healthy, no recent data e.g. no spend) | stale (source connector behind) | no_data (never seen).';
