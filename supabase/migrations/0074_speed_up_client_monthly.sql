-- 0074_speed_up_client_monthly.sql — applied live 2026-09-22.
--
-- v_client_monthly is the client page's biggest query. Measured for Contingent before this:
-- 3602 ms. It was slow for two reasons, both structural rather than data volume:
--
--   1. It joined client_sources BEFORE aggregating, so a lookup that exists only to fetch a
--      brand/label ran once per PRE-aggregation row — 24,470 times to produce 2,306 rows,
--      which was 2.6 s of the 3.6 s and 65,039 shared buffer hits on its own.
--   2. Grouping by the joined label columns forced a sort over 24,470 wide rows, spilling
--      2.4 MB to disk on every page load.
--
-- Rewritten to aggregate first and label afterwards: the lateral lookup now runs 2,306 times.
-- `clients` is joined INSIDE the aggregate so a `where slug = …` from the caller pushes down to
-- the index instead of aggregating every client and filtering afterwards (that mistake cost a
-- full 122,989-row sequential scan when tried the other way round).
--
-- The lateral also carries `limit 1`, which removes a latent correctness risk: the old LEFT JOIN
-- would multiply a row if two mappings ever matched one account_ext_id.
--
-- Plus a partial index matching the rollup's own shape and filter, so the scan skips the 11,440
-- breakout rows it used to read and discard.
--
-- Measured after: 477 ms with the rewrite alone, 171 ms with the index — 21x faster.
-- Verified byte-identical first: same column list, 12,932 rows both, and EXCEPT ALL in BOTH
-- directions returned zero rows.

create index if not exists mv_mmd_rollup
  on private.mv_metrics_monthly_dim (client_id, source, account_ext_id, metric_name, agg, month_start)
  where not public.is_breakout(qualifier);

create or replace view public.v_client_monthly as
with agg as (
  select c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.metric_name, mv.agg, mv.month_start,
         case mv.agg
           when 'avg'  then avg(mv.value)
           when 'last' then sum(mv.value)          -- per-entity stocks add up; see 0073
           when 'max'  then max(mv.value)
           when 'min'  then min(mv.value)
           else sum(mv.value)
         end as value,
         max(mv.days) as day_count
  from private.mv_metrics_monthly_dim mv
  join public.clients c on c.id = mv.client_id
  where not (mv.source = 'ga4' and mv.metric_name in ('users','new_users'))   -- see 0009
    and not public.is_breakout(mv.qualifier)                                   -- see 0071
  group by c.slug, mv.client_id, mv.source, mv.account_ext_id, mv.metric_name, mv.agg, mv.month_start
)
select a.slug, a.client_id, a.source, a.account_ext_id,
       coalesce(cs.params ->> 'brand', cs.params ->> 'state', '') as brand,
       coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(a.account_ext_id, '')) as account_label,
       a.metric_name, d.unit, a.agg, d.direction_default as direction, a.month_start,
       a.value, a.day_count, d.provenance as description
from agg a
left join lateral (
  select cs.params from public.client_sources cs
  where cs.client_id = a.client_id and cs.source = a.source
    and public.same_account_id(cs.external_id, a.account_ext_id)
  limit 1
) cs on true
left join public.metric_definitions d on d.source = a.source and d.metric_name = a.metric_name;

alter view public.v_client_monthly set (security_invoker = true);   -- CREATE OR REPLACE drops it, see 0065
grant select on public.v_client_monthly to authenticated, service_role;
