-- 0079_baseline_window_in_index.sql — applied live 2026-09-23.
--
-- 0078 regressed the plan. Its window bounds lived in a `win` CTE cross-joined into the query. In
-- 0076 the `ser` CTE was referenced twice, so Postgres materialised it and happened to put `win`
-- where the bounds reached the fact_daily index. 0078 moved first_seen onto the provenance rollup,
-- which left `ser` referenced once; Postgres inlined it and chose a join order with `win` outside
-- the loop. The date range fell out of the index condition into a join filter:
--     Index Scan using fact_daily_pkey  Index Cond: (series_id = s.series_id)
--     Rows Removed by Join Filter: 310,595
-- — every series' ENTIRE history read to keep 32,879 rows. Contingent went from ~260 ms to ~535 ms
-- warm.
--
-- The bounds are now written directly as expressions of the function's parameters. They are
-- constants for the call, so they sit in the index condition whatever join order the planner picks.
-- Semantics are unchanged from 0078: same window, capped at the end of the prior month; same
-- first_seen; same rules.
--
-- Verified: 64 partial windows (8 clients x windows of 1 to 31 days, including past February's end)
-- return exactly what the 0078 body returns — 5,493 rows, EXCEPT ALL zero both ways, 5 of them with
-- partial mappings; full months still reproduce v_client_monthly for all 218 client-months. Warm, as
-- role authenticated: Contingent ~296 ms, ECH 122, Kellogg 103, Deksia 52. A larger work_mem was
-- measured twice and made no difference, so none is set.
--
-- KNOWN LIMITATION, not addressed here: the page passes ONE window length for every source — the
-- largest day count of any source this month. A source that reports late (Search Console, ~3 days)
-- has fewer days this month than that, so it is compared against more days of last month than it
-- has this month. Contingent, 2026-09-22: 18 days of Search Console vs 21 of August. Fixing it needs
-- a per-source data-through date, which is a methodology decision, not a speed one.

create or replace function public.client_prev_partial(p_slug text, p_prev_month text, p_days integer)
returns table(source text, account_ext_id text, metric_name text, value numeric, day_count integer, complete boolean)
language sql stable set search_path = public as $$
  with first_seen as (
    -- when each mapping first reported (the 0072 guard) — see 0078
    select pv.source, pv.account_ext_id, min(pv.first_day) as first_day
    from private.mv_client_provenance pv
    where pv.slug = p_slug
    group by pv.source, pv.account_ext_id
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
    from public.series s
    join public.clients c on c.id = s.client_id
    join public.fact_daily f on f.series_id = s.series_id
    join public.metric_definitions d on d.metric_id = f.metric_id
    where c.slug = p_slug
      -- the window: the first p_days of the prior month, never past its end (0078)
      and f.metric_date >= (p_prev_month || '-01')::date
      and f.metric_date <  least((p_prev_month || '-01')::date + p_days,
                                 ((p_prev_month || '-01')::date + interval '1 month')::date)
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
         coalesce(bool_and(fs.first_day <= (p_prev_month || '-01')::date), false)
  from per_entity p
  left join first_seen fs on fs.source = p.source and fs.account_ext_id = p.account_ext_id
  group by p.source, p.account_ext_id, p.metric_name, p.agg;
$$;
