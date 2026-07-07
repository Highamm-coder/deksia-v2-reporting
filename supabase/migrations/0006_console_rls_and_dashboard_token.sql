-- 0006: capture console RLS policies (repo/live sync) + read-only dashboard token RPC.
-- Idempotent: safe to re-run on a DB where the policies already exist.
-- (Mirrors live migration: console_rls_and_dashboard_token.)

-- ---------- dashboard token accessor (read path; separate from ingest write token) ----------
create or replace function public.get_dashboard_token() returns text
  language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_token' limit 1;
$$;
revoke all on function public.get_dashboard_token() from public, anon, authenticated;
grant execute on function public.get_dashboard_token() to service_role;

-- ---------- console RLS policies (authenticated team role) ----------
-- Admin tables: full read/write for authenticated console users.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clients' and policyname='auth_all') then
    create policy auth_all on public.clients for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='client_sources' and policyname='auth_all') then
    create policy auth_all on public.client_sources for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='goals' and policyname='auth_all') then
    create policy auth_all on public.goals for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='metric_definitions' and policyname='auth_all') then
    create policy auth_all on public.metric_definitions for all to authenticated using (true) with check (true);
  end if;
  -- Fact/history tables: read-only for authenticated (writes stay service-role).
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='metrics_daily' and policyname='auth_read') then
    create policy auth_read on public.metrics_daily for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='goal_progress' and policyname='auth_read') then
    create policy auth_read on public.goal_progress for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connector_health' and policyname='auth_read') then
    create policy auth_read on public.connector_health for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='run_log' and policyname='auth_read') then
    create policy auth_read on public.run_log for select to authenticated using (true);
  end if;
end $$;
