-- V2 Reporting — goal_targets
-- Structured goal definitions the daily routine iterates over.
-- Maintained by the agent (parses the Smart Goal Tracker → here); read at run time.

create table if not exists public.goal_targets (
  client text not null,
  goal_row int not null,             -- absolute row in the source goal tab
  campaign text,
  tactic text,
  channel text,
  metric text not null,
  source text,                       -- callrail / meta / pages / ga4 / google_ads
  target numeric,
  unit text,                         -- int / pct / usd / ratio
  direction text default 'hib',      -- hib (higher better) | lib (lower better)
  period_type text default 'monthly',-- monthly | quarterly | yearly
  coverage text default 'auto',      -- auto | awaiting
  params jsonb default '{}'::jsonb,  -- source-specific: ids, source filters, mql def
  active boolean default true,
  updated_at timestamptz default now(),
  primary key (client, goal_row)
);
alter table public.goal_targets enable row level security;
create index if not exists goal_targets_source_idx on public.goal_targets (source) where active;

-- Example params shapes:
--   CallRail MQL:  {"company_id":"COM…","source_filter":["Facebook Ads","Instagram Ads"],"mql":"loose"}
--   Meta metric:   {"ad_account_ids":["164626062105963"],"field":"impressions"}
--   GA4 metric:    {"property":"properties/123","metric":"sessions","channel_group":"Organic Search"}
--   Pages metric:  {"page_id":"106281511431500","metric":"page_daily_follows_unique"}
