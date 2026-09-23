-- 0078_baseline_window_cap_and_first_seen.sql — applied live 2026-09-23.
--
-- Two fixes to client_prev_partial (0076) found by an adversarial review of that change, plus a
-- default so the page can call client_mtd_baseline as a retryable GET.
--
-- 1. THE WINDOW RAN PAST THE END OF THE PRIOR MONTH. w_end was simply start + p_days, so on
--    March 30-31 (elapsed 29-30 against February's 28) "the first 29 days of February" reached into
--    March 1-2 — days that are also in the current-month figure it is compared against. Carried
--    over unchanged from 0072; only full-month windows had been checked. Now capped at the first
--    of the next month: past that point the baseline IS the whole prior month, and the page labels
--    it that way.
--
-- 2. first_seen PROBED EVERY SERIES. One random index probe per series (1,934 for Contingent, 2,333
--    for Deksia), into the OLDEST leaf pages of fact_daily — the ones nothing else reads, so the
--    likeliest to be cold on a Micro instance whose buffers (224 MB) are smaller than the table
--    (244 MB). A cold call measured 2.6 s. private.mv_client_provenance.first_day is the same
--    quantity — min(metric_date) per client/source/account over every series, through the same
--    joins — maintained by refresh_rollups() in the same call that rebuilds the monthly rollup the
--    current-month figures come from. One indexed lookup per account instead of one probe per series.
--
-- 3. client_mtd_baseline's p_month gets DEFAULT NULL. supabase-js sends a GET argument of null as
--    the string "null"; with a default the page simply omits it.
--
-- Verified: mv_client_provenance.first_day equals the live per-series minimum for all 124 accounts
-- (same account set both sides); full-month windows still reproduce v_client_monthly exactly for all
-- 218 client-months; a 30-day window into 28-day February equals the 28-day one for 6 clients.
-- NOTE: this version regressed the query plan — fixed in 0079.

create or replace function public.client_prev_partial(p_slug text, p_prev_month text, p_days integer)
returns table(source text, account_ext_id text, metric_name text, value numeric, day_count integer, complete boolean)
language sql stable set search_path = public as $$
  with win as (
    select (p_prev_month || '-01')::date as w_start,
           least((p_prev_month || '-01')::date + p_days,
                 ((p_prev_month || '-01')::date + interval '1 month')::date) as w_end   -- never past the prior month
  ),
  ser as (
    select s.series_id, s.source, s.account_ext_id, s.entity, s.qualifier
    from public.series s join public.clients c on c.id = s.client_id
    where c.slug = p_slug
  ),
  -- when each mapping first reported (the 0072 guard): the provenance rollup already holds it
  first_seen as (
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

create or replace function public.client_mtd_baseline(p_slug text, p_month text default null)
returns json language plpgsql stable set search_path = public as $$
declare
  v_client uuid;
  v_latest date;
  v_m date;
  v_days int;
  v_prev text;
begin
  select id into v_client from public.clients where slug = p_slug;
  if v_client is null then return null; end if;

  if p_month ~ '^\d{4}-\d{2}$' then
    select mv.month_start into v_m
      from private.mv_metrics_monthly_dim mv
     where mv.client_id = v_client and to_char(mv.month_start, 'YYYY-MM') = p_month   -- text, so '2026-13' misses instead of raising
       and not public.is_breakout(mv.qualifier)
       and not (mv.source = 'ga4' and mv.metric_name in ('users','new_users'))
     limit 1;
  end if;
  if v_m is null then
    select max(mv.month_start) into v_latest
      from private.mv_metrics_monthly_dim mv
     where mv.client_id = v_client
       and not public.is_breakout(mv.qualifier)
       and not (mv.source = 'ga4' and mv.metric_name in ('users','new_users'));
    v_m := v_latest;
  end if;
  if v_m is null or to_char(v_m, 'YYYY-MM') <> to_char(now() at time zone 'America/New_York', 'YYYY-MM') then
    return null;
  end if;

  select max(mv.days)::int into v_days
    from private.mv_metrics_monthly_dim mv
   where mv.client_id = v_client and mv.month_start = v_m
     and not public.is_breakout(mv.qualifier)
     and not (mv.source = 'ga4' and mv.metric_name in ('users','new_users'));
  if coalesce(v_days, 0) <= 0 then return null; end if;

  v_prev := to_char(v_m - interval '1 month', 'YYYY-MM');
  return json_build_object(
    'month', v_prev,
    'days',  v_days,
    'rows',  (select coalesce(json_agg(b), '[]'::json) from public.client_prev_partial(p_slug, v_prev, v_days) b)
  );
end;
$$;
