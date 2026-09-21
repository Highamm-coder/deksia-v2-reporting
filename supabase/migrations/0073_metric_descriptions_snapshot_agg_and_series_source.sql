-- 0073_metric_descriptions_snapshot_agg_and_series_source.sql — applied live 2026-09-21.
-- The remaining data-side findings from the UAT review. Three independent fixes.
--
-- 1. METRIC DESCRIPTIONS REACH THE TOOLTIP.
--    Performance.js renders <td title={r.description}> on every metric row, but the view the
--    client page actually reads (v_client_monthly) never selected a description, so the tooltip
--    was always empty. metric_definitions.provenance already holds real, written descriptions
--    (e.g. meta.ctr: "Account-level rate as Meta reports it — never averaged from ad rows").
--    ~200 Meta metrics render as raw names today, including literal pixel ids such as
--    cpa_offsite_conversion.custom.631134662571057. Adding the column makes the existing
--    tooltip work with no UI change. (The review named v_client_report_detail, but that view
--    has no consumer — verified against the app, report_pack, every view and every function.)
--
-- 2. SNAPSHOT METRICS NO LONGER COLLAPSE WITH max().
--    For agg='last' (YouTube subscribers_total / views_total / videos_total), the rollup already
--    reduces each series to its last value in the month. v_client_monthly then groups away
--    entity/qualifier and took max() across them, which is not "last" and not a total. Summing
--    the per-series last values is the correct rollup for a stock measured per entity: two
--    channels' subscriber counts add up to the client's subscriber count, which is the same
--    class of aggregation as summing two ad accounts' spend (rule 2 allows summing additive
--    counts to a coarser key). Identical result when there is one series, which is every case
--    today — youtube has no mapped channels yet, so this lands before it can be wrong.
--
-- 3. report_pack()'s monthly_series CARRIES ITS SOURCE.
--    It grouped by metric_name alone, so 'clicks' or 'impressions' would silently merge paid and
--    organic (both exist under google_ads, meta, ga4, pages and search_console). Dormant today
--    because the deck only trends uniquely-named metrics, but it is a landmine in the one
--    function the org treats as the single source of truth. Each point now carries 'source'.
--    Consumers that summed blindly get the same totals only if they aggregate per source.

-- ---- 1 + 2: v_client_monthly ----------------------------------------------------------------
create or replace view public.v_client_monthly as
select c.slug,
       mv.client_id,
       mv.source,
       mv.account_ext_id,
       coalesce(cs.params ->> 'brand', cs.params ->> 'state', '') as brand,
       coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(mv.account_ext_id, '')) as account_label,
       mv.metric_name,
       d.unit,
       mv.agg,
       d.direction_default as direction,
       mv.month_start,
       case mv.agg
         when 'avg'  then avg(mv.value)
         -- was max(): see note 2 above
         when 'last' then sum(mv.value)
         when 'max'  then max(mv.value)
         when 'min'  then min(mv.value)
         else sum(mv.value)
       end as value,
       max(mv.days) as day_count,
       d.provenance as description
from private.mv_metrics_monthly_dim mv
  join public.clients c on c.id = mv.client_id
  left join public.client_sources cs
    on cs.client_id = mv.client_id and cs.source = mv.source
   and public.same_account_id(cs.external_id, mv.account_ext_id)
  left join public.metric_definitions d
    on d.source = mv.source and d.metric_name = mv.metric_name
where not (mv.source = 'ga4' and mv.metric_name in ('users', 'new_users'))
  and not public.is_breakout(mv.qualifier)
group by c.slug, mv.client_id, mv.source, mv.account_ext_id,
         coalesce(cs.params ->> 'brand', cs.params ->> 'state', ''),
         coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(mv.account_ext_id, '')),
         mv.metric_name, d.unit, mv.agg, d.direction_default, mv.month_start, d.provenance;

alter view public.v_client_monthly set (security_invoker = true);   -- see 0065
grant select on public.v_client_monthly to authenticated, service_role;

-- ---- 3: report_pack monthly_series carries its source ----------------------------------------
do $$
declare
  src     text := pg_get_functiondef('public.report_pack'::regproc);
  oldblk  constant text := $old$      select metric_name, month_start, sum(value) as value
      from v_client_monthly where slug = p_slug and agg = 'sum' and metric_name <> 'conversion_action'
      group by metric_name, month_start$old$;
  newblk  constant text := $new$      select source, metric_name, month_start, sum(value) as value
      from v_client_monthly where slug = p_slug and agg = 'sum' and metric_name <> 'conversion_action'
      group by source, metric_name, month_start$new$;
  oldsel  constant text := $olds$      'metric', s.metric_name, 'month', to_char(s.month_start, 'YYYY-MM'), 'value', s.value$olds$;
  newsel  constant text := $news$      'source', s.source, 'metric', s.metric_name, 'month', to_char(s.month_start, 'YYYY-MM'), 'value', s.value$news$;
begin
  if position(oldblk in src) = 0 or position(oldsel in src) = 0 then
    raise exception '0073: report_pack monthly_series is not in the expected shape — refusing to guess';
  end if;
  src := replace(src, oldblk, newblk);
  src := replace(src, oldsel, newsel);
  execute src;
end $$;
