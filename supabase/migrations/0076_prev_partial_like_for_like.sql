-- 0076_prev_partial_like_for_like.sql — applied live 2026-09-23.
--
-- client_prev_partial supplies the baseline for an in-progress month: "the first N days of last
-- month", compared against this month so far. It had two defects, one a correctness bug.
--
-- 1. IT DID NOT COMPUTE THE SAME THING IT WAS COMPARED AGAINST. It summed every daily row it found
--    straight off metrics_daily, while the current-month figure comes from the monthly rollup, which
--    excludes breakouts (ad:, ag:, kw:, term:, dev:, net:, age:, gender:, brk:) and `rate` rows and
--    aggregates per entity first. Over a COMPLETE month the two should agree exactly; for Contingent,
--    August, they did not:
--        Meta spend           5,897 monthly  vs 14,401 baseline   (2.44x — ad-level rows summed in)
--        Google Ads clicks    3,614 monthly  vs  7,228 baseline   (2.00x — ad-group rows summed in)
--        Google Ads CPM       114.2 monthly  vs  393.6 baseline   (averaged over breakout rows)
--    GA4 and Search Console matched, having no breakouts. So every current-month "vs last month" on a
--    paid metric was measured against a baseline inflated 2-2.4x, which reads as roughly -50%.
--
-- 2. IT HAD OUTGROWN THE TIMEOUT. `first_seen` took min(metric_date) over the client's ENTIRE daily
--    history through metrics_daily's four-way join, and fact_daily (244 MB) no longer fits in shared
--    buffers (224 MB). 4-6 s per call all day; from 19:16 on 2026-09-22 it crossed the 8 s
--    statement_timeout for `authenticated` and every call returned HTTP 500. The page reads a failed
--    RPC as an empty baseline, so the current month showed no comparison at all — silently.
--
-- Rewritten to apply the rollup's own rules over a window of days instead of a month:
--   per entity, exactly as private.mv_metrics_monthly_dim does (avg / last-by-date / max / min / sum,
--   days = distinct dates), then across entities exactly as v_client_monthly does (avg of entity
--   values, `last` summed per 0073, max, min, sum; day_count = max days; breakouts and GA4
--   users/new_users excluded). It reads fact_daily ⋈ series directly: metrics_daily's joins to
--   ingest_batches and metric_definitions are on NOT NULL foreign keys, so they never drop a row.
--   first_seen becomes one index-only probe per series on fact_daily_pkey.
--
-- Verified before the swap:
--   * Full-month windows for EVERY client-month in the rollup (218 of them) reproduce
--     v_client_monthly exactly: 12,932 rows both, EXCEPT ALL zero in both directions, values AND
--     day counts. The rollup had no batches newer than its refresh, so it was an exact reference.
--   * The `complete` flag (0072's partial-baseline guard) matches the old function in all 17 windows
--     and 113 accounts compared, including the 2 genuine partial-mapping cases.
--   * Timing, 21-day window: Contingent 6,057 ms -> 261 ms; ECH 128 ms warm, ~1.1 s cold.
--
-- Same signature and return type, so callers are unchanged; CREATE OR REPLACE keeps the grants.

create or replace function public.client_prev_partial(p_slug text, p_prev_month text, p_days integer)
returns table(source text, account_ext_id text, metric_name text, value numeric, day_count integer, complete boolean)
language sql stable set search_path = public as $$
  with win as (
    select (p_prev_month || '-01')::date as w_start,
           ((p_prev_month || '-01')::date + make_interval(days => p_days))::date as w_end
  ),
  ser as (
    select s.series_id, s.source, s.account_ext_id, s.entity, s.qualifier
    from public.series s join public.clients c on c.id = s.client_id
    where c.slug = p_slug
  ),
  -- when each mapping first reported, over ALL its series — the 0072 guard, unchanged in meaning
  first_seen as (
    select s.source, s.account_ext_id, min(fm.metric_date) as first_day
    from ser s
    cross join lateral (select f.metric_date from public.fact_daily f
                        where f.series_id = s.series_id order by f.metric_date limit 1) fm
    group by s.source, s.account_ext_id
  ),
  -- the rollup's per-entity step (private.mv_metrics_monthly_dim), over the window
  per_entity as (
    select s.source, s.account_ext_id, s.entity, s.qualifier, d.metric_name,
           coalesce(d.agg, 'sum') as agg,
           case coalesce(d.agg, 'sum')
             when 'avg'  then avg(f.value)
             when 'last' then (array_agg(f.value order by f.metric_date desc))[1]
             when 'max'  then max(f.value)
             when 'min'  then min(f.value)
             else sum(f.value) end as value,
           count(distinct f.metric_date) as days
    from ser s
    join public.fact_daily f on f.series_id = s.series_id
    join public.metric_definitions d on d.metric_id = f.metric_id
    cross join win
    where f.metric_date >= win.w_start and f.metric_date < win.w_end
      and s.qualifier !~ '^(brk|term|kw|dev|net|age|gender):'           -- the rollup's own filter
      and not public.is_breakout(s.qualifier)                           -- v_client_monthly's, see 0071
      and not (s.source = 'ga4' and d.metric_name in ('users','new_users'))   -- see 0009
    group by s.source, s.account_ext_id, s.entity, s.qualifier, d.metric_name, coalesce(d.agg, 'sum')
  )
  -- v_client_monthly's cross-entity step
  select p.source, p.account_ext_id, p.metric_name,
         case p.agg when 'avg' then avg(p.value) when 'last' then sum(p.value)   -- see 0073
                    when 'max' then max(p.value) when 'min' then min(p.value) else sum(p.value) end,
         max(p.days)::int,
         coalesce(bool_and(fs.first_day <= (select w_start from win)), false)
  from per_entity p
  left join first_seen fs on fs.source = p.source and fs.account_ext_id = p.account_ext_id
  group by p.source, p.account_ext_id, p.metric_name, p.agg;
$$;

drop function if exists public.zz_prev_partial(text, text, integer);
