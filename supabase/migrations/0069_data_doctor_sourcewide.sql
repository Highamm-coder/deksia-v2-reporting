-- 0069_data_doctor_sourcewide.sql — applied live 2026-09-16. doctor_fix() refinement after the first
-- dry run: eight GA4 properties were all missing 2026-09-01 — one bad daily run, not eight client
-- problems. When ≥ 3 clients share the same single-day gap on a source, queue ONE source-wide
-- re-pull for that day (client_slug null) instead of a job per client; it costs one chunk and does
-- not burn the per-run job cap. Per-client jobs remain for everything else. Body otherwise as 0068.
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
  g          record;
  v_jobs     int := 0;
  v_gads     int := 0;
  v_job      uuid;
  v_start    date;
  v_end      date;
  m          date;
  v_today    date := (now() at time zone 'America/New_York')::date;
  v_run      bigint;
  v_handled  text[] := '{}';   -- 'source|date' single-day gaps covered by a source-wide job
begin
  if not (public.is_admin() or current_setting('request.jwt.claim.role', true) = 'service_role' or session_user = 'postgres') then
    raise exception 'doctor_fix: admins or service role only';
  end if;
  v_findings := public.doctor_findings(30);

  -- 0. shared single-day gaps → one source-wide re-pull per (source, day)
  for g in
    select x->>'source' as source, (x->>'from_date')::date as day, count(*) as n, array_agg(x->>'slug' order by x->>'slug') as slugs
    from jsonb_array_elements(v_findings) x
    where x->>'kind' = 'client_gap' and (x->>'n_days')::int = 1
    group by 1, 2 having count(*) >= 3
    order by 2
  loop
    if v_jobs >= p_max_jobs then exit; end if;
    if g.source = 'google_ads' and v_gads >= 1 then continue; end if;
    if not p_dry_run then
      insert into backfill_jobs (source, client_slug, start_date, end_date, note, created_by)
      values (g.source, null, g.day, g.day,
              format('doctor: %s clients had no %s rows for %s while the source was pulled — one source-wide re-pull (%s)', g.n, g.source, g.day, array_to_string(g.slugs, ', ')),
              'doctor/' || p_actor)
      returning id into v_job;
      insert into backfill_chunks (job_id, chunk_start, chunk_end) values (v_job, g.day, g.day);
    end if;
    v_jobs := v_jobs + 1; if g.source = 'google_ads' then v_gads := v_gads + 1; end if;
    v_handled := v_handled || (g.source || '|' || g.day::text);
    v_actions := v_actions || jsonb_build_object('action', 'queued_repull_sourcewide', 'source', g.source, 'from_date', g.day, 'to_date', g.day,
                  'clients', to_jsonb(g.slugs), 'job_id', v_job, 'dry_run', p_dry_run);
  end loop;

  for f in select * from jsonb_array_elements(v_findings) loop
    -- 1. re-pull a client gap
    if f->>'kind' = 'client_gap' and v_jobs < p_max_jobs then
      if (f->>'n_days')::int = 1 and (f->>'source' || '|' || (f->>'from_date')) = any (v_handled) then continue; end if;
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
