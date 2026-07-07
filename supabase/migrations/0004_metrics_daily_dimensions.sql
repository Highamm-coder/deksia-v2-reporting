-- Add sub-client dimensions to metrics_daily so a metric can be specific to an
-- account / campaign / conversion-action. Existing rows default to '' (client-level).
alter table public.metrics_daily add column if not exists account_ext_id text not null default ''; -- Ads CID / GA4 property / sub-account
alter table public.metrics_daily add column if not exists entity        text not null default ''; -- campaign (or brand)
alter table public.metrics_daily add column if not exists qualifier     text not null default ''; -- conversion action, segment, etc.

alter table public.metrics_daily drop constraint metrics_daily_pkey;
alter table public.metrics_daily add constraint metrics_daily_pkey
  primary key (client_id, source, metric_name, metric_date, account_ext_id, entity, qualifier);

create index if not exists metrics_daily_entity_idx on public.metrics_daily(entity) where entity <> '';

insert into public.metric_definitions (source, metric_name, unit, direction_default, agg, description) values
  ('google_ads','conversion_action','int','increase','sum','Conversions by conversion-action name')
on conflict (source, metric_name) do nothing;
