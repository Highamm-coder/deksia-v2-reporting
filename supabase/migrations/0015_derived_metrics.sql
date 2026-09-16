-- 0015: custom computed metrics (e.g. Blended CPL) — ratio-of-sums formulas over
-- platform-faithful additive inputs. Provenance rules: a derived metric is
-- Deksia-computed, never a platform number; its formula is stored and displayed.
-- Only additive (agg='sum') metrics may be used as terms — rates can't be summed.

create table if not exists public.derived_metrics (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete cascade, -- null = all clients
  name        text not null,   -- slug, e.g. 'blended_cpl'
  label       text not null,   -- display, e.g. 'Blended CPL'
  unit        text not null default 'usd' check (unit in ('usd','ratio','pct','int')),
  numerator   jsonb not null,  -- [{"source":"meta","metric":"spend"}, ...]
  denominator jsonb not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists derived_metrics_scope_name
  on public.derived_metrics (name, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.derived_metrics enable row level security;
drop policy if exists auth_all on public.derived_metrics;
create policy auth_all on public.derived_metrics
  for all to authenticated using (true) with check (true);

-- default: Blended CPL = (Meta spend + Google Ads spend) ÷ (Meta leads + CallRail MQLs)
insert into public.derived_metrics (client_id, name, label, unit, numerator, denominator)
select null, 'blended_cpl', 'Blended CPL', 'usd',
  '[{"source":"meta","metric":"spend"},{"source":"google_ads","metric":"spend"}]'::jsonb,
  '[{"source":"meta","metric":"leads"},{"source":"callrail","metric":"mqls"}]'::jsonb
where not exists (select 1 from public.derived_metrics where name='blended_cpl' and client_id is null);

-- monthly computation per client: latest month vs previous, with the raw numerator/
-- denominator sums exposed so the UI can show "= $3,584 ÷ 107" (provenance).
create or replace view public.v_client_derived
with (security_invoker = on) as
with dm as (select * from public.derived_metrics where active),
terms as (
  select dm.id as dm_id, p.part, e->>'source' as src, e->>'metric' as met
  from dm,
  lateral (values ('num', dm.numerator), ('den', dm.denominator)) as p(part, arr),
  lateral jsonb_array_elements(p.arr) as e
),
sums as (
  select md.client_id, t.dm_id, t.part,
         date_trunc('month', md.metric_date)::date as ms, sum(md.value) as v
  from public.metrics_daily md
  join terms t on t.src = md.source and t.met = md.metric_name
  group by 1, 2, 3, 4
),
pivot as (
  select s.client_id, s.dm_id, s.ms,
    coalesce(sum(v) filter (where part = 'num'), 0) as num,
    coalesce(sum(v) filter (where part = 'den'), 0) as den
  from sums s group by 1, 2, 3
),
scoped as (
  select p.* from pivot p join dm on dm.id = p.dm_id
  where dm.client_id is null or dm.client_id = p.client_id
),
ranked as (
  select s.*, row_number() over (partition by client_id, dm_id order by ms desc) as rn
  from scoped s
)
select
  c.slug, r.client_id, dm.id as derived_id, dm.name, dm.label, dm.unit,
  dm.numerator, dm.denominator,
  r.ms  as cur_month,
  r.num as cur_num,
  r.den as cur_den,
  case when r.den <> 0 then r.num / r.den end as cur_value,
  p2.ms as prev_month,
  case when p2.den <> 0 then p2.num / p2.den end as prev_value,
  case when p2.den <> 0 and p2.num <> 0 and r.den <> 0 and (p2.num / p2.den) <> 0
       then ((r.num / r.den) - (p2.num / p2.den)) / abs(p2.num / p2.den) end as pct_change
from ranked r
join dm on dm.id = r.dm_id
join public.clients c on c.id = r.client_id
left join ranked p2 on p2.client_id = r.client_id and p2.dm_id = r.dm_id and p2.rn = 2
where r.rn = 1;

comment on view public.v_client_derived is
  'Deksia-computed metrics (ratio of additive platform sums) per client, latest vs prev month, with raw num/den exposed for formula display.';
