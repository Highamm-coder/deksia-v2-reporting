-- V2 Reporting — core schema
-- Run against the deksia-reporting Supabase project (ykxauddrsnuwkvimkdhw).

-- Fact table: one row per client goal per snapshot day (daily upsert).
create table if not exists public.metric_snapshots (
  snapshot_date date not null,
  period text,                       -- period the actual covers, e.g. '2026-05' or '2026-Q2'
  client text not null,              -- goal-tab name (join key)
  full_client_name text,
  campaign text,
  tactic text,
  channel text,                      -- meta / pages / callrail / ga4 / google_ads / seo / ...
  metric text not null,
  source text,                       -- connector that produced the actual
  target numeric,
  actual numeric,
  attainment numeric,                -- ratio (1.0 = 100%); direction-aware
  status text,                       -- On Track / Off Track / Awaiting / ...
  unit text,                         -- int / pct / usd / ratio
  note text,
  goal_row int not null,             -- absolute row in the source goal tab
  inserted_at timestamptz not null default now(),
  primary key (snapshot_date, client, goal_row)
);
create index if not exists metric_snapshots_client_idx on public.metric_snapshots (client);
create index if not exists metric_snapshots_period_idx on public.metric_snapshots (period);
create index if not exists metric_snapshots_status_idx on public.metric_snapshots (status);
create index if not exists metric_snapshots_metric_idx on public.metric_snapshots (metric);
alter table public.metric_snapshots enable row level security;

-- Latest health status per source (upserted each run) for a live status board.
create table if not exists public.connector_health (
  source text primary key,
  status text not null,              -- flowing / degraded / idle / not_flowing / offline
  detail text,
  checked_at timestamptz not null default now()
);
alter table public.connector_health enable row level security;

-- One row per daily run, for observability.
create table if not exists public.run_log (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  period text,
  clients_processed int,
  rows_written int,
  sources text[],
  notes text
);
alter table public.run_log enable row level security;

-- NOTE: RLS is enabled with no policies = service-role-only access (secure default).
-- Add a read policy only if a public/anon dashboard needs to query these tables.
