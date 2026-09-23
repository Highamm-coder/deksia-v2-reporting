-- 0077_one_request_per_page.sql — applied live 2026-09-23.
--
-- PostgREST on this project runs a pool of TEN database connections (its own log: "Connection Pool
-- initialized with a maximum size of 10 connections"), on Micro compute. Loading one client page
-- sent about 23 requests at once — 13 from the page, 3 more pages of results, 1 from the layout,
-- 5 from the sidebar — so more than half waited in line for a connection. In production, on
-- 2026-09-22 23:52, one-row queries such as `integrity_checks … limit 1` took 3.5 s end to end;
-- none of that was their own work, which is under 10 ms.
--
-- Three functions, each replacing a fan-out with ONE request:
--
--   client_page_data(slug)        the 13 page queries, as one JSON document. Each key is exactly the
--                                 rows the old query returned, in the same order, built with
--                                 json_agg over the same view — which is how PostgREST builds its own
--                                 response body, so the page receives the same JSON. One value also
--                                 means no 1000-row cap and no paging round trips.
--   client_mtd_baseline(slug, m)  the in-progress month's baseline, fetched IN PARALLEL with the page
--                                 data instead of after it. It works out which month the page will
--                                 show and how many days have elapsed; the page recomputes both and
--                                 uses this result ONLY if they agree, otherwise it calls
--                                 client_prev_partial itself. A disagreement costs a round trip,
--                                 never a wrong number.
--   app_shell_data()              the sidebar's 5 queries plus its auth-server call. The e-mail it
--                                 displays comes from the JWT PostgREST has already verified.
--
-- All three are SECURITY INVOKER (the default): they read the same views as the signed-in user,
-- under the same RLS, as the queries they replace.
--
-- One deliberate difference: the sidebar's "last sync" ordered by last_ingested_at DESC, which in
-- Postgres puts NULLs first, and three pipeline rows have no ingest yet — so the freshness card has
-- been blank. It now skips NULLs and shows the latest real ingest.

create or replace function public.client_page_data(p_slug text)
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'monthly',        (select coalesce(json_agg(v order by v.month_start, v.source, v.metric_name, v.account_ext_id), '[]'::json)
                         from public.v_client_monthly v where v.slug = p_slug),
    'campaigns',      (select coalesce(json_agg(v order by v.month_start, v.source, v.account_ext_id, v.campaign), '[]'::json)
                         from public.v_client_campaigns_all v where v.slug = p_slug),
    'goals',          (select coalesce(json_agg(v order by v.metric_name), '[]'::json)
                         from public.v_goal_scoreboard v where v.slug = p_slug),
    'provenance',     (select coalesce(json_agg(v), '[]'::json)
                         from public.v_client_provenance v where v.slug = p_slug),
    'derived',        (select coalesce(json_agg(v order by v.label), '[]'::json)
                         from public.v_client_derived_all v where v.slug = p_slug),
    'health',         (select coalesce(json_agg(v order by v.source), '[]'::json)
                         from public.v_pipeline_health v where v.slug = p_slug),
    'events',         (select coalesce(json_agg(v), '[]'::json)
                         from public.v_client_events v where v.slug = p_slug),
    -- the old query embedded clients!inner(slug); the same nested object is kept for shape parity
    'objectives',     (select coalesce(json_agg(o order by o.kind, o.position, o.created_at), '[]'::json)
                         from (select co.*, json_build_object('slug', c.slug) as clients
                                 from public.client_objectives co join public.clients c on c.id = co.client_id
                                where c.slug = p_slug and co.active) o),
    'drill',          (select coalesce(json_agg(v order by v.month_start, v.source, v.account_ext_id, v.campaign, v.child), '[]'::json)
                         from public.v_client_campaign_drill v where v.slug = p_slug),
    'lead_sources',   (select coalesce(json_agg(v), '[]'::json)
                         from public.v_client_lead_sources v where v.slug = p_slug),
    'source_status',  (select coalesce(json_agg(v), '[]'::json)
                         from public.v_client_source_status v where v.slug = p_slug),
    'search_queries', (select coalesce(json_agg(v), '[]'::json)
                         from public.v_client_search_queries v where v.slug = p_slug),
    'sc_mappings',    (select coalesce(json_agg(x), '[]'::json)
                         from (select cs.source, cs.params, json_build_object('slug', c.slug) as clients
                                 from public.client_sources cs join public.clients c on c.id = cs.client_id
                                where c.slug = p_slug and cs.source = 'search_console' and cs.active) x)
  );
$$;

-- Mirrors web/app/clients/[slug]/page.js: M = the requested month if it has data, else the latest
-- month with data; a baseline exists only when M is the current month in New York and at least one
-- day has elapsed. Months and elapsed days are read from the same rollup rows v_client_monthly
-- aggregates (breakouts and GA4 users/new_users excluded), so max(days) here equals the page's
-- max(day_count). Returns null when there is no baseline to fetch.
create or replace function public.client_mtd_baseline(p_slug text, p_month text)
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

create or replace function public.app_shell_data()
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'clients',   (select coalesce(json_agg(c order by c.slug), '[]'::json)
                    from (select slug, name, status from public.clients) c),
    'last_sync', (select h.last_ingested_at from public.v_pipeline_health h
                   where h.last_ingested_at is not null
                   order by h.last_ingested_at desc limit 1),
    'creds',     (select coalesce(json_agg(x), '[]'::json)
                    from (select provider, status, expires_at from public.connector_status) x),
    'integrity', (select row_to_json(x)
                    from (select status, checked_at from public.integrity_checks
                          order by checked_at desc limit 1) x),
    'is_admin',  public.is_admin(),
    'email',     auth.jwt() ->> 'email'
  );
$$;

revoke all on function public.client_page_data(text)          from public, anon;
revoke all on function public.client_mtd_baseline(text, text) from public, anon;
revoke all on function public.app_shell_data()                from public, anon;
grant execute on function public.client_page_data(text)          to authenticated, service_role;
grant execute on function public.client_mtd_baseline(text, text) to authenticated, service_role;
grant execute on function public.app_shell_data()                to authenticated, service_role;
