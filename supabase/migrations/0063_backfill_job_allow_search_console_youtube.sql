-- 0063_backfill_job_allow_search_console_youtube.sql — applied live 2026-09-16. create_backfill_job()
-- carried the same five-source whitelist as the old client_sources check (0062), so the console's
-- Backfills form rejected search_console with "unknown source". Extend the list; body otherwise unchanged.
create or replace function public.create_backfill_job(p_source text, p_client_slug text, p_start date, p_end date, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid; m date;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_end < p_start then raise exception 'end before start'; end if;
  if p_end >= current_date then raise exception 'end must be before today (yesterday is the latest closed day)'; end if;
  if p_source is not null and p_source not in ('meta','ga4','callrail','pages','google_ads','search_console','youtube') then raise exception 'unknown source'; end if;
  if p_client_slug is not null and not exists (select 1 from clients where slug = p_client_slug) then raise exception 'unknown client'; end if;

  insert into backfill_jobs (source, client_slug, start_date, end_date, note, created_by)
  values (nullif(p_source,''), nullif(p_client_slug,''), p_start, p_end, p_note, coalesce(auth.jwt() ->> 'email', 'console'))
  returning id into v_id;

  for m in select generate_series(date_trunc('month', p_start)::date, date_trunc('month', p_end)::date, interval '1 month')::date loop
    insert into backfill_chunks (job_id, chunk_start, chunk_end)
    values (v_id, greatest(m, p_start), least((m + interval '1 month' - interval '1 day')::date, p_end));
  end loop;
  return v_id;
end $$;
