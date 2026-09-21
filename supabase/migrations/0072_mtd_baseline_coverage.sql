-- 0072_mtd_baseline_coverage.sql — applied live 2026-09-21.
--
-- THE BUG. client_prev_partial() builds the "same N days of last month" baseline behind every
-- month-to-date comparison. It summed whatever rows existed in that window without checking that
-- the window was actually covered, so a mapping that started mid-month produced a baseline from
-- fewer days and the page rendered a confident percentage off it.
--
-- Measured before this migration — Goodside, google_ads spend, today = 2026-09-21 (21 elapsed days):
--   first day of data for that mapping   2026-08-11
--   baseline "1–21 Aug"                  $22.77   (only 11 days actually present)
--   September 1–21                       $113.54
--   rendered                             +399% MoM — entirely an artifact of the start date
--
-- THE FIX. Return a `complete` flag per series: true only when that mapping produced its first row
-- on or before the first day of the baseline window. Absence of rows on a given day is NOT treated
-- as missing coverage — a genuinely quiet day (a CallRail company with no calls) correctly stays
-- complete. Only a mapping that did not exist yet is incomplete. The console drops incomplete
-- baselines rather than dividing by them, and says so instead of showing a number.
--
-- Return type changes, so this is DROP + CREATE rather than CREATE OR REPLACE. SECURITY INVOKER
-- (the default) is kept deliberately: the caller's RLS must still apply.

drop function if exists public.client_prev_partial(text, text, integer);

create function public.client_prev_partial(p_slug text, p_prev_month text, p_days integer)
returns table (
  source          text,
  account_ext_id  text,
  metric_name     text,
  value           numeric,
  day_count       integer,
  complete        boolean
)
language sql
stable
set search_path to 'public'
as $$
  with win as (
    select (p_prev_month || '-01')::date as w_start,
           (p_prev_month || '-01')::date + make_interval(days => p_days) as w_end
  ),
  -- first day this client/source/account ever reported anything, at any grain
  first_seen as (
    select m.source, m.account_ext_id, min(m.metric_date) as first_day
    from public.metrics_daily m
    join public.clients c on c.id = m.client_id
    where c.slug = p_slug
    group by m.source, m.account_ext_id
  )
  select m.source, m.account_ext_id, m.metric_name,
    case coalesce(d.agg,'sum')
      when 'avg'  then avg(m.value)
      when 'last' then (array_agg(m.value order by m.metric_date desc))[1]
      when 'max'  then max(m.value)
      when 'min'  then min(m.value)
      else sum(m.value) end as value,
    count(distinct m.metric_date)::int as day_count,
    coalesce(bool_and(fs.first_day <= (select w_start from win)), false) as complete
  from public.metrics_daily m
  join public.clients c on c.id = m.client_id
  left join public.metric_definitions d
    on d.source = m.source and d.metric_name = m.metric_name
  left join first_seen fs
    on fs.source = m.source and fs.account_ext_id = m.account_ext_id
  where c.slug = p_slug
    and m.metric_date >= (select w_start from win)
    and m.metric_date <  (select w_end from win)
    and not (m.source = 'ga4' and m.metric_name in ('users','new_users'))
  group by m.source, m.account_ext_id, m.metric_name, coalesce(d.agg,'sum');
$$;

comment on function public.client_prev_partial(text, text, integer) is
  'Same-N-days-of-last-month baseline for MTD comparisons. `complete` is false when the mapping did not exist for the whole window — the console must not compute a delta from those rows (see 0072).';

grant execute on function public.client_prev_partial(text, text, integer) to authenticated, service_role;
