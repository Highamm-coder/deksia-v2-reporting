-- 0061_metric_defs_seq_burn.sql — applied live 2026-09-16. Incident: ensure_metric_defs() used
-- INSERT … ON CONFLICT DO NOTHING over every metric in every ingest call, and Postgres calls
-- nextval() for each candidate row even when it conflicts. The smallint sequence
-- metric_definitions_metric_id_seq hit 32767 with only 284 definitions, and from 15:19 UTC every
-- ingest_rows() call failed ("nextval: reached maximum value"). Fix: insert only metrics that do not
-- exist yet (ON CONFLICT kept as a race guard), then reset the sequence to max(metric_id) = 32282.
-- ids above that were never handed out: fact_daily.metric_id is an FK to metric_definitions.

create or replace function public.ensure_metric_defs(p_source text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int;
begin
  insert into public.metric_definitions (source, metric_name, unit, agg, direction_default, description, provenance)
  select p_source, x.metric, coalesce(nullif(x.unit,''), 'int'),
    case
      when x.metric ~ '^(cpa_|cost_per|cpc$|cpm$|cpp$|cpv$)' then 'avg'
      when x.metric ~ '(_rate$|_ctr$|^ctr$|_share$|_pct$|quality_score|^position$)' then 'avg'
      when coalesce(x.unit,'') in ('pct','pos') then 'avg'
      else 'sum'
    end,
    case when x.metric ~ '^(cpa_|cost_per|cpc$|cpm$|cpp$|cpv$|lost_is_|position$)' then 'decrease' else 'increase' end,
    'auto-registered on first ingest',
    'Platform-reported. Aggregation inferred from the metric name at registration.'
  from jsonb_to_recordset(p_rows) as x(metric text, unit text)
  where x.metric is not null
    -- only genuinely new metrics reach the INSERT, so nextval() is called only for them
    and not exists (
      select 1 from public.metric_definitions d
      where d.source = p_source and d.metric_name = x.metric)
  on conflict (source, metric_name) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- hand out the unused ids again (next value = 32283)
select setval('public.metric_definitions_metric_id_seq',
              (select max(metric_id) from public.metric_definitions), true);
