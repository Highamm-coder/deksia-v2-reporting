-- 0013: data provenance as a first-class feature.
-- Principle (Matt, 2026-07-10): the cardinal sin is not knowing exactly where a number
-- came from. Every metric must be traceable to platform → account → API method →
-- writer → pull time, visible on demand without cluttering the default view.

-- 1) Method dictionary: how each source's data reaches the warehouse.
create table if not exists public.source_methods (
  source  text primary key,
  method  text not null,   -- one-sentence human explanation
  api     text not null,   -- endpoint + grain
  cadence text not null    -- when / by what
);
alter table public.source_methods enable row level security;
drop policy if exists auth_read on public.source_methods;
create policy auth_read on public.source_methods for select to authenticated using (true);

insert into public.source_methods (source, method, api, cadence) values
  ('meta',       'Pulled directly from Meta''s reporting API. Counts at ad level; CTR/CPC/CPL/Reach at account level exactly as Meta computes them (never re-derived).',
                 'Graph API v21 /act_{id}/insights — level=ad (counts) + level=account (rates, reach, cost_per_action_type)',
                 'GitHub Actions, daily ~7:00 AM ET, previous day'),
  ('google_ads', 'Pushed by Google Ads Scripts running inside the ad accounts (Deksia MCC 929-098-5791 + per-account scripts for accounts we don''t manage). No spreadsheet middleman.',
                 'GAQL ad_group report (campaign → ad group) + campaign conversion_action report → POST to ingest-metrics',
                 'Google Ads Script schedule (nightly, per account timezone), previous day'),
  ('ga4',        'Pulled directly from Google Analytics'' reporting API at the finest non-BigQuery grain. Users/new-users are stored raw but excluded from reporting sums (non-additive).',
                 'GA4 Data API v1beta runReport — day × default channel group × source/medium per property',
                 'GitHub Actions, daily ~7:00 AM ET, previous day'),
  ('callrail',   'Pulled from CallRail''s REST API; every call and form submission counted by its CallRail-attributed lead source. Qualified = CallRail''s own lead_status = good_lead.',
                 'CallRail v3 /calls + /form_submissions per company, bucketed by source and lead_status',
                 'GitHub Actions, daily ~7:00 AM ET, previous day'),
  ('pages',      'Pulled from Facebook''s Page Insights for pages where the system user has an Analyze role.',
                 'Graph API v21 /{page}/insights period=day (follows, reach, engagement, video views)',
                 'GitHub Actions, daily ~7:00 AM ET, previous day')
on conflict (source) do update set method=excluded.method, api=excluded.api, cadence=excluded.cadence;

-- 2) Metric-level provenance notes (exceptions/definitions worth surfacing).
alter table public.metric_definitions add column if not exists provenance text;
update public.metric_definitions set provenance = v.p from (values
  ('meta','ctr','Account-level rate as Meta reports it — never averaged from ad rows.'),
  ('meta','cpc','Account-level rate as Meta reports it — never averaged from ad rows.'),
  ('meta','cost_per_lead','Meta''s own cost_per_action_type[lead], account level.'),
  ('meta','reach','Unique people (account level) — not summable across ads or days.'),
  ('ga4','users','Stored per segment but excluded from reporting sums — unique users are non-additive across channels/days.'),
  ('ga4','new_users','Stored per segment but excluded from reporting sums — non-additive.'),
  ('callrail','qualified_leads','Count of calls+forms CallRail scored lead_status=good_lead.'),
  ('callrail','mqls','Calls + form submissions (CallRail-attributed, per lead source).'),
  ('google_ads','conversion_action','Conversions broken out by Google Ads conversion-action name (campaign level).')
) as v(s,m,p) where metric_definitions.source=v.s and metric_definitions.metric_name=v.m;

-- 3) Per-client provenance view: for every (client, source, account) — the label, the
-- method, the coverage window, when it last landed, and who wrote it (meta->>'by').
create or replace view public.v_client_provenance
with (security_invoker = on) as
select
  c.slug,
  m.source,
  m.account_ext_id,
  coalesce(cs.params->>'label', nullif(m.account_ext_id, ''), '(account level)') as account_label,
  coalesce(cs.params->>'brand', cs.params->>'state', '')                          as brand,
  sm.method, sm.api, sm.cadence,
  min(m.metric_date)  as first_day,
  max(m.metric_date)  as last_day,
  max(m.ingested_at)  as last_ingested,
  count(*)            as rows,
  array_agg(distinct coalesce(m.meta->>'by', 'unrecorded')) as writers
from public.metrics_daily m
join public.clients c on c.id = m.client_id
left join public.client_sources cs
  on cs.client_id = m.client_id and cs.source = m.source
 and regexp_replace(cs.external_id, '\D', '', 'g') = regexp_replace(m.account_ext_id, '\D', '', 'g')
left join public.source_methods sm on sm.source = m.source
group by c.slug, m.source, m.account_ext_id,
         coalesce(cs.params->>'label', nullif(m.account_ext_id, ''), '(account level)'),
         coalesce(cs.params->>'brand', cs.params->>'state', ''),
         sm.method, sm.api, sm.cadence;

comment on view public.v_client_provenance is
  'Provenance per (client, source, account): label, pull method/API/cadence, coverage window, last ingest, writers. The "where did this number come from" surface.';

-- 4) Fix the label join in v_client_report_detail (was exact-match; Google Ads rows
-- carry dashed CIDs while client_sources stores digits → labels fell back to raw IDs).
create or replace view public.v_client_report_detail
with (security_invoker = on) as
with monthly as (
  select m.client_id, m.source, m.account_ext_id, m.metric_name,
    date_trunc('month', m.metric_date)::date as month_start,
    case coalesce(d.agg, 'sum')
      when 'avg'  then avg(m.value)
      when 'last' then (array_agg(m.value order by m.metric_date desc))[1]
      when 'max'  then max(m.value)
      when 'min'  then min(m.value)
      else sum(m.value)
    end as value,
    coalesce(d.agg, 'sum') as agg,
    count(distinct m.metric_date) as day_count
  from public.metrics_daily m
  left join public.metric_definitions d
    on d.source = m.source and d.metric_name = m.metric_name
  where not (m.source = 'ga4' and m.metric_name in ('users', 'new_users'))
  group by m.client_id, m.source, m.account_ext_id, m.metric_name,
           date_trunc('month', m.metric_date), coalesce(d.agg, 'sum')
),
ranked as (
  select *,
    row_number() over (
      partition by client_id, source, account_ext_id, metric_name
      order by month_start desc
    ) as rn
  from monthly
)
select
  c.slug,
  cur.client_id,
  cur.source,
  cur.account_ext_id,
  coalesce(cs.params->>'brand', cs.params->>'state', '') as brand,
  coalesce(cs.params->>'label', nullif(cur.account_ext_id, ''))   as account_label,
  cur.metric_name,
  d.unit,
  cur.agg,
  d.direction_default as direction,
  cur.month_start     as cur_month,
  cur.value           as cur_value,
  cur.day_count       as cur_days,
  prev.month_start    as prev_month,
  prev.value          as prev_value,
  prev.day_count      as prev_days,
  case
    when prev.value is not null and prev.value <> 0
      then (cur.value - prev.value) / abs(prev.value)
  end                 as pct_change
from ranked cur
join public.clients c on c.id = cur.client_id
left join ranked prev
  on prev.client_id = cur.client_id
 and prev.source = cur.source
 and prev.account_ext_id = cur.account_ext_id
 and prev.metric_name = cur.metric_name
 and prev.rn = 2
left join public.client_sources cs
  on cs.client_id = cur.client_id
 and cs.source = cur.source
 and regexp_replace(cs.external_id, '\D', '', 'g') = regexp_replace(cur.account_ext_id, '\D', '', 'g')
left join public.metric_definitions d
  on d.source = cur.source and d.metric_name = cur.metric_name
where cur.rn = 1;
