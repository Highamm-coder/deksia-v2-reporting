-- Deksia Client Performance + SMART Goals Platform — core schema, tracker, orchestration.
-- Additive to 0001/0002. Timezone convention for date boundaries: America/New_York.
-- (Mirrors the migrations applied live: platform_core_schema, ingest_token_rpc,
--  goal_tracker, orchestration_cron, harden_views_and_functions.)

-- ---------- helpers ----------
create or replace function public.set_updated_at() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- clients ----------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text,
  status text not null default 'active' check (status in ('active','paused','archived')),
  timezone text not null default 'America/New_York',
  monthly_budget numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();
alter table public.clients enable row level security;

-- ---------- client_sources ----------
create table if not exists public.client_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null check (source in ('google_ads','ga4','meta','callrail','pages')),
  external_id text not null,
  params jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, source, external_id)
);
create index if not exists client_sources_client_idx on public.client_sources(client_id);
create index if not exists client_sources_source_idx on public.client_sources(source) where active;
create trigger trg_client_sources_updated before update on public.client_sources
  for each row execute function public.set_updated_at();
alter table public.client_sources enable row level security;

-- ---------- metric_definitions (measurable universe; goals FK to it) ----------
create table if not exists public.metric_definitions (
  source text not null,
  metric_name text not null,
  unit text not null default 'int',
  direction_default text not null default 'increase' check (direction_default in ('increase','decrease')),
  agg text not null default 'sum' check (agg in ('sum','avg','last','max','min')),
  description text,
  primary key (source, metric_name)
);
alter table public.metric_definitions enable row level security;

-- ---------- metrics_daily (tall fact, idempotent daily grain) ----------
create table if not exists public.metrics_daily (
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null,
  metric_name text not null,
  metric_date date not null,
  value numeric,
  unit text,
  meta jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  primary key (client_id, source, metric_name, metric_date)
);
create index if not exists metrics_daily_client_idx on public.metrics_daily(client_id);
create index if not exists metrics_daily_source_idx on public.metrics_daily(source);
create index if not exists metrics_daily_date_idx   on public.metrics_daily(metric_date);
create index if not exists metrics_daily_metric_idx on public.metrics_daily(metric_name);
alter table public.metrics_daily enable row level security;

-- ---------- goals (SMART by enforcement) ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null,
  metric_name text not null,
  baseline_value numeric,
  target_value numeric not null,
  direction text not null default 'increase' check (direction in ('increase','decrease')),
  start_date date not null default current_date,
  due_date date not null,
  cadence text not null default 'monthly',
  status text not null default 'pending'
    check (status in ('pending','on_track','at_risk','off_track','achieved','missed')),
  current_value numeric, pct_to_target numeric, projected_value numeric,
  last_computed_at timestamptz, notes text,
  params jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (source, metric_name) references public.metric_definitions(source, metric_name)
);
create index if not exists goals_client_idx on public.goals(client_id);
create index if not exists goals_active_idx on public.goals(active) where active;
create trigger trg_goals_updated before update on public.goals
  for each row execute function public.set_updated_at();
alter table public.goals enable row level security;

-- ---------- goal_progress (append-only snapshots) ----------
create table if not exists public.goal_progress (
  id bigint generated always as identity primary key,
  goal_id uuid not null references public.goals(id) on delete cascade,
  as_of_date date not null,
  current_value numeric, abs_progress numeric, pct_to_target numeric,
  required_pace numeric, actual_pace numeric, projected_value numeric,
  pace_status text,
  computed_at timestamptz not null default now(),
  unique (goal_id, as_of_date)
);
create index if not exists goal_progress_goal_idx on public.goal_progress(goal_id);
alter table public.goal_progress enable row level security;

create or replace function public.goal_progress_append_only() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'goal_progress is append-only; % is not allowed', TG_OP; end $$;
create trigger trg_goal_progress_no_update before update on public.goal_progress
  for each row execute function public.goal_progress_append_only();
create trigger trg_goal_progress_no_delete before delete on public.goal_progress
  for each row execute function public.goal_progress_append_only();

-- ---------- rollup views (security_invoker so callers' RLS applies) ----------
create or replace view public.metrics_weekly with (security_invoker = on) as
select m.client_id, m.source, m.metric_name, date_trunc('week', m.metric_date)::date as week_start,
       case coalesce(d.agg,'sum') when 'avg' then avg(m.value)
         when 'last' then (array_agg(m.value order by m.metric_date desc))[1]
         when 'max' then max(m.value) when 'min' then min(m.value) else sum(m.value) end as value,
       coalesce(d.agg,'sum') as agg, count(*) as day_count
from public.metrics_daily m
left join public.metric_definitions d on d.source=m.source and d.metric_name=m.metric_name
group by m.client_id, m.source, m.metric_name, date_trunc('week', m.metric_date), d.agg;

create or replace view public.metrics_monthly with (security_invoker = on) as
select m.client_id, m.source, m.metric_name, date_trunc('month', m.metric_date)::date as month_start,
       case coalesce(d.agg,'sum') when 'avg' then avg(m.value)
         when 'last' then (array_agg(m.value order by m.metric_date desc))[1]
         when 'max' then max(m.value) when 'min' then min(m.value) else sum(m.value) end as value,
       coalesce(d.agg,'sum') as agg, count(*) as day_count
from public.metrics_daily m
left join public.metric_definitions d on d.source=m.source and d.metric_name=m.metric_name
group by m.client_id, m.source, m.metric_name, date_trunc('month', m.metric_date), d.agg;

create or replace view public.v_pipeline_health with (security_invoker = on) as
select c.slug, c.name, c.status as client_status, s.source,
       count(distinct s.external_id) as id_count,
       max(m.metric_date) as last_metric_date, max(m.ingested_at) as last_ingested_at,
       count(m.*) filter (where m.metric_date >= (now() at time zone 'America/New_York')::date - 30) as rows_30d,
       count(distinct m.metric_name) as metric_count,
       case when max(m.ingested_at) is null then 'no_data'
            when max(m.ingested_at) < now() - interval '2 days' then 'stale' else 'fresh' end as sync_status
from public.clients c
join public.client_sources s on s.client_id=c.id and s.active
left join public.metrics_daily m on m.client_id=c.id and m.source=s.source
where c.status='active'
group by c.slug, c.name, c.status, s.source;

create or replace view public.v_goal_scoreboard with (security_invoker = on) as
select c.slug, c.name, g.id as goal_id, g.source, g.metric_name,
       g.target_value, g.current_value, g.pct_to_target, g.direction, g.status,
       g.start_date, g.due_date,
       (g.due_date - (now() at time zone 'America/New_York')::date) as days_remaining,
       g.projected_value, g.last_computed_at,
       (g.status in ('at_risk','off_track','missed')) as needs_attention
from public.goals g join public.clients c on c.id=g.client_id
where g.active;

-- ---------- ingest token accessor (Vault) ----------
create or replace function public.get_ingest_token() returns text
  language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ingest_token' limit 1;
$$;
revoke all on function public.get_ingest_token() from public, anon, authenticated;
grant execute on function public.get_ingest_token() to service_role;

-- ---------- SMART goal tracker ----------
create or replace function public.run_goal_tracker(p_as_of date default (now() at time zone 'America/New_York')::date)
returns table(goals_processed int, snapshots_written int)
language plpgsql set search_path = public, pg_temp as $$
declare
  g record; v_agg text; v_current numeric; v_total_days int; v_elapsed int;
  v_expected numeric; v_required numeric; v_actual numeric; v_projected numeric;
  v_pct numeric; v_abs numeric; v_status text; v_cumulative boolean; v_at_due boolean;
  n_goals int := 0; n_snaps int := 0; ins int;
begin
  for g in select * from public.goals where active loop
    n_goals := n_goals + 1;
    select coalesce(agg,'sum') into v_agg from public.metric_definitions
      where source=g.source and metric_name=g.metric_name;
    v_agg := coalesce(v_agg,'sum'); v_cumulative := (v_agg = 'sum');
    v_total_days := greatest((g.due_date - g.start_date) + 1, 1);
    v_elapsed := greatest(least(p_as_of, g.due_date) - g.start_date + 1, 0);
    v_at_due := (p_as_of >= g.due_date);
    select case v_agg when 'avg' then avg(value)
             when 'last' then (array_agg(value order by metric_date desc))[1]
             when 'max' then max(value) when 'min' then min(value) else sum(value) end
      into v_current from public.metrics_daily
     where client_id=g.client_id and source=g.source and metric_name=g.metric_name
       and metric_date between g.start_date and least(p_as_of, g.due_date);
    if v_current is null or v_elapsed <= 0 then
      v_pct:=null; v_abs:=null; v_required:=null; v_actual:=null; v_projected:=null; v_status:='pending';
    else
      v_abs := v_current - coalesce(g.baseline_value,0);
      if g.direction='increase' then v_pct := v_current / nullif(g.target_value,0);
      else v_pct := g.target_value / nullif(v_current,0); end if;
      if v_cumulative then
        v_expected := g.target_value * v_elapsed::numeric / v_total_days;
        v_required := g.target_value / v_total_days;
        v_actual := v_current / nullif(v_elapsed,0); v_projected := v_actual * v_total_days;
        if g.direction='increase' then
          if v_current >= g.target_value then v_status:='achieved';
          elsif v_at_due then v_status:='missed';
          elsif v_current >= v_expected then v_status:='on_track';
          elsif v_current >= 0.85*v_expected then v_status:='at_risk';
          else v_status:='off_track'; end if;
        else
          if v_at_due then v_status := case when v_current <= g.target_value then 'achieved' else 'missed' end;
          elsif v_current <= v_expected then v_status:='on_track';
          elsif v_current <= 1.15*v_expected then v_status:='at_risk';
          else v_status:='off_track'; end if;
        end if;
      else
        v_required:=null; v_actual:=null; v_projected:=v_current;
        if g.direction='increase' then
          if v_at_due then v_status := case when v_current >= g.target_value then 'achieved' else 'missed' end;
          elsif v_current >= g.target_value then v_status:='on_track';
          elsif v_current >= 0.85*g.target_value then v_status:='at_risk';
          else v_status:='off_track'; end if;
        else
          if v_at_due then v_status := case when v_current <= g.target_value then 'achieved' else 'missed' end;
          elsif v_current <= g.target_value then v_status:='on_track';
          elsif v_current <= 1.15*g.target_value then v_status:='at_risk';
          else v_status:='off_track'; end if;
        end if;
      end if;
    end if;
    insert into public.goal_progress
      (goal_id, as_of_date, current_value, abs_progress, pct_to_target,
       required_pace, actual_pace, projected_value, pace_status)
    values (g.id, p_as_of, v_current, v_abs, v_pct, v_required, v_actual, v_projected, v_status)
    on conflict (goal_id, as_of_date) do nothing;
    get diagnostics ins = row_count; n_snaps := n_snaps + ins;
    update public.goals set status=v_status, current_value=v_current, pct_to_target=v_pct,
           projected_value=v_projected, last_computed_at=now() where id=g.id;
  end loop;
  goals_processed := n_goals; snapshots_written := n_snaps; return next;
end $$;
revoke all on function public.run_goal_tracker(date) from public, anon, authenticated;
grant execute on function public.run_goal_tracker(date) to service_role;

-- ---------- orchestration: daily in-DB tracker ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('goal-tracker-daily', '0 10 * * *', $$ select public.run_goal_tracker(); $$);
