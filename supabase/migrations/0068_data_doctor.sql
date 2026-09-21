-- 0068_data_doctor.sql — applied live 2026-09-16. The data doctor: a deterministic scan of data
-- completeness and connection health per CLIENT MAPPING (the integrity sentinel only looks per
-- source, so one client's missing day is invisible to it), plus the safe fixes it may apply on its
-- own. Run by the `data-doctor` skill on a routine; every run and every action is logged in
-- doctor_runs so the console and the next run can see exactly what was done and why.
--
-- Rules the doctor obeys (Matt's standing rules):
--   • It never edits, fills or derives data. The only data fix is a RE-PULL from the platform
--     (a backfill job), which is idempotent: a genuinely empty day stays empty.
--   • A (mapping, day) is re-pulled at most once by the doctor. If it is still empty afterwards it
--     is reported as "verified empty", never re-queued — otherwise a quiet CallRail day or a
--     Search Console property with no impressions would be re-pulled forever.
--   • Gap detection only applies to DENSE mappings (rows on ≥ 80 % of the days in the window) and
--     only for days the source as a whole was pulled (source_days) — a sparse mapping has no
--     "expected" day, so absence is not evidence.
--   • Credentials, access grants and API enablement are reported, never touched.
--   • Google Ads: at most one doctor job per run (Explorer quota, 3 chunks/day).

create table if not exists public.doctor_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  actor       text        not null,
  dry_run     boolean     not null default false,
  n_findings  int         not null default 0,
  n_actions   int         not null default 0,
  findings    jsonb       not null default '[]'::jsonb,
  actions     jsonb       not null default '[]'::jsonb
);
alter table public.doctor_runs enable row level security;
drop policy if exists doctor_runs_admin_read on public.doctor_runs;
create policy doctor_runs_admin_read on public.doctor_runs for select to authenticated using (public.is_admin());
grant select on public.doctor_runs to authenticated, service_role;
create index if not exists doctor_runs_ran_at on public.doctor_runs (ran_at desc);

-- ---------------------------------------------------------------------------------------------
-- doctor_findings(p_days): everything wrong right now, as a JSON array of
--   { kind, severity: high|warn|info, slug, source, account, detail, fix: <what doctor_fix may do> }
-- ---------------------------------------------------------------------------------------------
create or replace function public.doctor_findings(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with et as (
  select (now() at time zone 'America/New_York')::date as today
),
maps as (
  select cs.id as mapping_id, cs.client_id, c.slug, cs.source, cs.external_id, cs.created_at,
         coalesce(sm.lag_days, 0) as lag_days
  from client_sources cs
  join clients c on c.id = cs.client_id
  join source_methods sm on sm.source = cs.source
  where cs.active and c.status = 'active' and sm.active and cs.source <> 'manual'
),
cov as (  -- days with any stored row per mapping, inside the window
  select m.mapping_id, f.metric_date
  from maps m
  join series s on s.client_id = m.client_id and s.source = m.source
                and public.same_account_id(m.external_id, s.account_ext_id)
  join fact_daily f on f.series_id = s.series_id
  where f.metric_date >= (select today from et) - p_days
  group by 1, 2
),
covs as (
  select mapping_id, min(metric_date) as first_day, max(metric_date) as last_day, count(*) as days
  from cov group by 1
),
ever as (  -- has the mapping ever produced a row at all?
  select m.mapping_id
  from maps m
  where exists (select 1 from series s join fact_daily f on f.series_id = s.series_id
                where s.client_id = m.client_id and s.source = m.source
                  and public.same_account_id(m.external_id, s.account_ext_id))
),
expected as (
  select m.*, cv.first_day, cv.last_day, cv.days,
         (select today from et) - 1 - m.lag_days as horizon,
         greatest(cv.first_day, (select today from et) - p_days) as win_start
  from maps m join covs cv on cv.mapping_id = m.mapping_id
),
dense as (
  select * from expected
  where horizon >= win_start
    and days::numeric / greatest((horizon - win_start + 1), 1) >= 0.8
),
gap_days as (
  select d.mapping_id, d.slug, d.source, d.external_id, g::date as gap_date
  from dense d
  cross join lateral generate_series(d.win_start, d.horizon, interval '1 day') g
  where not exists (select 1 from cov c where c.mapping_id = d.mapping_id and c.metric_date = g::date)
    and exists (select 1 from source_days sd where sd.source = d.source and sd.metric_date = g::date)
),
gap_attempted as (  -- already re-pulled once by the doctor → verified empty
  select g.*,
         exists (select 1 from backfill_jobs j join backfill_chunks ch on ch.job_id = j.id
                 where j.created_by like 'doctor%' and j.source = g.source and j.client_slug = g.slug
                   and g.gap_date between ch.chunk_start and ch.chunk_end and ch.status = 'done') as attempted,
         exists (select 1 from backfill_jobs j join backfill_chunks ch on ch.job_id = j.id
                 where j.status = 'active' and j.source = g.source and coalesce(j.client_slug, g.slug) = g.slug
                   and g.gap_date between ch.chunk_start and ch.chunk_end and ch.status <> 'done') as in_flight
  from gap_days g
),
gap_groups as (
  select slug, source, external_id, attempted, in_flight,
         min(gap_date) as from_date, max(gap_date) as to_date, count(*) as n_days,
         array_agg(gap_date order by gap_date) as dates
  from gap_attempted
  group by slug, source, external_id, attempted, in_flight
),
status as (
  select * from v_client_source_status
),
f_gaps as (
  select jsonb_build_object(
    'kind', case when in_flight then 'gap_in_flight' when attempted then 'verified_empty' else 'client_gap' end,
    'severity', case when in_flight or attempted then 'info'
                     when to_date >= (select today from et) - 7 then 'warn' else 'info' end,
    'slug', slug, 'source', source, 'account', external_id,
    'from_date', from_date, 'to_date', to_date, 'n_days', n_days,
    'detail', format('%s day(s) with no rows between %s and %s while the source was pulled', n_days, from_date, to_date),
    'fix', case when in_flight then 'a backfill chunk covering this is already queued'
                when attempted then 'none — re-pulled once by the doctor and still empty; the platform reports nothing for these days'
                else 'queue a re-pull (backfill job) for the range' end
  ) as f from gap_groups
),
f_never as (
  select jsonb_build_object(
    'kind', 'never_pulled', 'severity', 'high',
    'slug', m.slug, 'source', m.source, 'account', m.external_id,
    'detail', format('mapped %s ago, no rows ever stored%s', date_trunc('day', now() - m.created_at)::text,
                     case when st.reachable is false then ' — probe: unreachable' when st.reachable then ' — probe: reachable' else '' end),
    'fix', case when st.reachable then 'queue a 30-day re-pull once' else 'needs access first (see unreachable)' end,
    'reachable', st.reachable
  ) as f
  from maps m
  left join status st on st.slug = m.slug and st.source = m.source
  where m.mapping_id not in (select mapping_id from ever)
    and m.created_at < now() - interval '2 days'
    and not exists (select 1 from backfill_jobs j where j.created_by like 'doctor%' and j.source = m.source and j.client_slug = m.slug)
),
f_unreach as (
  select jsonb_build_object(
    'kind', 'unreachable', 'severity', 'high',
    'slug', st.slug, 'source', st.source, 'account', null,
    'detail', coalesce(st.probe_detail, 'probe failed'),
    'probed_at', st.probed_at,
    'fix', 'none — needs access or a corrected id; ask Matt'
  ) as f
  from status st where st.reachable is false
),
f_cred as (
  select jsonb_build_object(
    'kind', case when cs.status <> 'ok' then 'credential_bad' else 'credential_expiring' end,
    'severity', case when cs.status <> 'ok' then 'high' else 'warn' end,
    'slug', null, 'source', cs.provider, 'account', cs.identity,
    'detail', format('%s · %s%s', cs.status, cs.detail,
                     case when cs.expires_at is not null then format(' · expires %s (%s days)', cs.expires_at::date, (cs.expires_at::date - (select today from et))) else '' end),
    'fix', 'none — credentials are installed by Matt'
  ) as f
  from connector_status cs
  where cs.status <> 'ok' or (cs.expires_at is not null and cs.expires_at < now() + interval '21 days')
),
f_chunks as (
  select jsonb_build_object(
    'kind', case when ch.status = 'error' then 'chunk_exhausted' else 'chunk_deferred' end,
    'severity', case when ch.status = 'error' then 'warn' else 'info' end,
    'slug', j.client_slug, 'source', j.source, 'account', null,
    'detail', format('chunk %s %s..%s: %s after %s attempt(s)%s', ch.id, ch.chunk_start, ch.chunk_end, ch.status, ch.attempts,
                     case when ch.retry_after is not null then format(' · retry after %s', ch.retry_after) else '' end)
              || coalesce(' · ' || left(ch.error, 160), ''),
    'fix', case when ch.status = 'error' then 'none automatically — read the error; a transient one can be reset to pending by hand' else 'wait' end
  ) as f
  from backfill_chunks ch join backfill_jobs j on j.id = ch.job_id
  where j.status = 'active'
    and ((ch.status = 'error' and ch.attempts >= 3) or (ch.status = 'deferred' and ch.retry_after > now() + interval '12 hours'))
),
f_rollup as (
  select jsonb_build_object(
    'kind', 'stale_rollup', 'severity', 'warn', 'slug', null, 'source', null, 'account', null,
    'detail', format('rollups last refreshed %s (%s ago)', r.refreshed_at, date_trunc('minute', now() - r.refreshed_at)),
    'fix', 'refresh_rollups()'
  ) as f
  from rollup_status r where r.refreshed_at < now() - interval '2 hours'
),
f_size as (
  select jsonb_build_object(
    'kind', 'db_size', 'severity', case when mb > 460 then 'high' else 'warn' end, 'slug', null, 'source', null, 'account', null,
    'detail', format('database is %s MB of the 500 MB free-tier cap', mb),
    'fix', 'none automatically — retention prune / vacuum full / plan upgrade'
  ) as f
  from (select round(pg_database_size(current_database()) / 1024.0 / 1024.0) as mb) x
  where mb > 400
),
f_unmapped as (
  select jsonb_build_object(
    'kind', 'discovered_unmapped', 'severity', 'info', 'slug', null, 'source', d.source, 'account', null,
    'detail', format('%s account(s) visible to our credentials but not mapped or ignored', count(*)),
    'fix', 'none — map or ignore on /connections'
  ) as f
  from connector_discovery d
  where d.ignored_at is null
    and not exists (select 1 from client_sources cs where cs.source = d.source and public.same_account_id(cs.external_id, d.external_id))
  group by d.source
)
select coalesce(jsonb_agg(f order by
         case f->>'severity' when 'high' then 0 when 'warn' then 1 else 2 end, f->>'kind', f->>'slug'), '[]'::jsonb)
from (
  select f from f_gaps union all select f from f_never union all select f from f_unreach
  union all select f from f_cred union all select f from f_chunks union all select f from f_rollup
  union all select f from f_size union all select f from f_unmapped
) all_f;
$$;

revoke all on function public.doctor_findings(integer) from public, anon;
grant execute on function public.doctor_findings(integer) to service_role, authenticated;  -- authenticated: admins read it on /data later

-- ---------------------------------------------------------------------------------------------
-- doctor_fix(p_actor, p_dry_run, p_max_jobs): apply the safe fixes and log the run.
--   • client_gap  → one backfill job per (slug, source) covering the gap range (monthly chunks)
--   • never_pulled + reachable → one 30-day backfill job
--   • stale_rollup → refresh_rollups()
--   Google Ads: at most one job per run. Total jobs capped at p_max_jobs.
-- Returns { run_id, n_findings, n_actions, actions: [...], findings: [...] }.
-- ---------------------------------------------------------------------------------------------
create or replace function public.doctor_fix(p_actor text default 'data-doctor', p_dry_run boolean default true, p_max_jobs integer default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_findings jsonb;
  v_actions  jsonb := '[]'::jsonb;
  f          jsonb;
  v_jobs     int := 0;
  v_gads     int := 0;
  v_job      uuid;
  v_start    date;
  v_end      date;
  m          date;
  v_today    date := (now() at time zone 'America/New_York')::date;
  v_run      bigint;
begin
  if not (public.is_admin() or current_setting('request.jwt.claim.role', true) = 'service_role' or session_user = 'postgres') then
    raise exception 'doctor_fix: admins or service role only';
  end if;
  v_findings := public.doctor_findings(30);

  for f in select * from jsonb_array_elements(v_findings) loop
    -- 1. re-pull a client gap
    if f->>'kind' = 'client_gap' and v_jobs < p_max_jobs then
      if f->>'source' = 'google_ads' and v_gads >= 1 then continue; end if;
      v_start := (f->>'from_date')::date; v_end := (f->>'to_date')::date;
      if not p_dry_run then
        insert into backfill_jobs (source, client_slug, start_date, end_date, note, created_by)
        values (f->>'source', f->>'slug', v_start, v_end,
                format('doctor: %s day(s) with no rows (%s) — re-pull, at most once per day', f->>'n_days', f->>'account'), 'doctor/' || p_actor)
        returning id into v_job;
        for m in select generate_series(date_trunc('month', v_start)::date, date_trunc('month', v_end)::date, interval '1 month')::date loop
          insert into backfill_chunks (job_id, chunk_start, chunk_end)
          values (v_job, greatest(m, v_start), least((m + interval '1 month' - interval '1 day')::date, v_end));
        end loop;
      end if;
      v_jobs := v_jobs + 1; if f->>'source' = 'google_ads' then v_gads := v_gads + 1; end if;
      v_actions := v_actions || jsonb_build_object('action', 'queued_repull', 'slug', f->>'slug', 'source', f->>'source',
                    'from_date', v_start, 'to_date', v_end, 'job_id', v_job, 'dry_run', p_dry_run);
    -- 2. first pull for a mapping that never produced rows but is reachable
    elsif f->>'kind' = 'never_pulled' and (f->>'reachable')::boolean is true and v_jobs < p_max_jobs then
      if f->>'source' = 'google_ads' and v_gads >= 1 then continue; end if;
      v_start := v_today - 30; v_end := v_today - 1;
      if not p_dry_run then
        insert into backfill_jobs (source, client_slug, start_date, end_date, note, created_by)
        values (f->>'source', f->>'slug', v_start, v_end, format('doctor: first pull for %s (mapped, reachable, no rows yet)', f->>'account'), 'doctor/' || p_actor)
        returning id into v_job;
        for m in select generate_series(date_trunc('month', v_start)::date, date_trunc('month', v_end)::date, interval '1 month')::date loop
          insert into backfill_chunks (job_id, chunk_start, chunk_end)
          values (v_job, greatest(m, v_start), least((m + interval '1 month' - interval '1 day')::date, v_end));
        end loop;
      end if;
      v_jobs := v_jobs + 1; if f->>'source' = 'google_ads' then v_gads := v_gads + 1; end if;
      v_actions := v_actions || jsonb_build_object('action', 'queued_first_pull', 'slug', f->>'slug', 'source', f->>'source',
                    'from_date', v_start, 'to_date', v_end, 'job_id', v_job, 'dry_run', p_dry_run);
    -- 3. stale rollups
    elsif f->>'kind' = 'stale_rollup' then
      if not p_dry_run then perform set_config('work_mem', '96MB', true); perform public.refresh_rollups(); end if;
      v_actions := v_actions || jsonb_build_object('action', 'refreshed_rollups', 'dry_run', p_dry_run);
    end if;
  end loop;

  insert into doctor_runs (actor, dry_run, n_findings, n_actions, findings, actions)
  values (p_actor, p_dry_run, jsonb_array_length(v_findings), jsonb_array_length(v_actions), v_findings, v_actions)
  returning id into v_run;

  return jsonb_build_object('run_id', v_run, 'dry_run', p_dry_run,
                            'n_findings', jsonb_array_length(v_findings), 'n_actions', jsonb_array_length(v_actions),
                            'actions', v_actions, 'findings', v_findings);
end $$;

revoke all on function public.doctor_fix(text, boolean, integer) from public, anon;
grant execute on function public.doctor_fix(text, boolean, integer) to service_role, authenticated;  -- body enforces is_admin()
