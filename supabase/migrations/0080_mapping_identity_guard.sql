-- 0080_mapping_identity_guard.sql — applied live 2026-11-03.
--
-- Goodside showed Online Orchards' Google Ads for two months. J&S Siding's real account
-- (645-355-9697) posted unmapped from 2026-08-06; on 2026-09-04 the alert was "resolved" by
-- mapping a DIFFERENT account, 4555222407, by hand in SQL with label "J&S Siding". Discovery saw
-- 4555222407 but had no name for it, so nothing contradicted the label. Its only campaign was
-- "Fruit Trees" converting on "Online Orchards - GA4 purchase". Split out 2026-11-03.
--
-- The console checks never ran (the row went in by SQL), so the guard lives on the table. It fires
-- when a row starts pointing at an account (insert, client or ID change, reactivation) or its
-- label changes. Errors start "mapping guard:" so the console can show them as they are.
--
--   1. One active owner per account. An account active on another client is rejected
--      (params.shared_ok = true to allow a real shared account).
--   2. An account discovery can see but cannot name needs params.name_verified: what the account
--      is called on the platform, written by the person who opened it there. That is exactly the
--      case that went wrong. Accounts discovery cannot see at all keep the console's existing
--      attach-by-id warning (discovery lags fresh grants).
--   3. A label must share a word with the discovered name (params.label_override = true to skip).
--      Exact equality is too strict: of 7 live labels that differ from the discovered name all 7 are
--      fine ("Medicare" vs "Moda Medicare [Deksia Managed]"), and every one shares a word.
--
-- A Search Console property's ID is its URL, so it names itself and is never "unnamed". A label or
-- name made only of noise words ("Deksia - GA4") can't be compared, so it passes.
--
-- v_mapping_identity_issues lists active mappings that would fail rules 2–3 today, for the
-- Connections page. Measured at apply time: 1 (Contingent's Meta 404646208539513, which discovery
-- names by its own ID).

create or replace function public.mapping_norm_id(p_source text, p_id text)
returns text language sql immutable as $$
  select case when p_source in ('google_ads','ga4','meta','pages')
              then nullif(regexp_replace(coalesce(p_id,''), '\D', '', 'g'), '')
              else nullif(btrim(coalesce(p_id,'')), '') end
$$;

-- words of a name worth comparing: lowercase alphanumeric runs of 3+ chars, minus URL/platform noise
create or replace function public.mapping_name_words(p text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct w), '{}')
  from regexp_split_to_table(lower(coalesce(p,'')), '[^a-z0-9]+') w
  where length(w) >= 3
    and w not in ('the','and','com','net','org','www','http','https','ga4','inc','llc','ads','page',
                  'account','property','managed','deksia')
$$;

-- discovery's view of an account: found?, and its name if it is a real one (not blank, not its own
-- ID). A Search Console property's ID is its URL, which names it — so it counts as named.
create or replace function public.mapping_discovered_name(p_source text, p_id text, out found boolean, out name text)
language sql stable as $$
  select count(*) > 0,
         max(case when p_source = 'search_console' then d.external_id
                  when btrim(coalesce(d.name,'')) <> ''
                   and public.mapping_norm_id(p_source, d.name) is distinct from public.mapping_norm_id(p_source, p_id)
                  then d.name end)
  from public.connector_discovery d
  where d.source = p_source and public.mapping_norm_id(d.source, d.external_id) = public.mapping_norm_id(p_source, p_id)
$$;

-- does a label plausibly name this account? Same text, or a shared word. A side with no comparable
-- words ("Deksia - GA4" is all noise words) can't be judged, so it passes.
create or replace function public.mapping_label_fits(p_label text, p_name text)
returns boolean language sql immutable as $$
  select lower(btrim(p_label)) = lower(btrim(p_name))
      or cardinality(public.mapping_name_words(p_label)) = 0
      or cardinality(public.mapping_name_words(p_name)) = 0
      or public.mapping_name_words(p_label) && public.mapping_name_words(p_name)
$$;

create or replace function public.guard_client_source()
returns trigger language plpgsql set search_path = public as $$
declare
  repointed boolean := tg_op = 'INSERT'
    or new.client_id is distinct from old.client_id
    or new.external_id is distinct from old.external_id
    or (new.active and not old.active);
  relabelled boolean := tg_op = 'UPDATE' and (new.params->>'label') is distinct from (old.params->>'label');
  other text;
  disc record;
begin
  if not (repointed or relabelled) or not new.active then return new; end if;

  -- 1) one active owner per account
  if repointed and coalesce((new.params->>'shared_ok')::boolean, false) is false then
    select c.slug into other
    from client_sources cs join clients c on c.id = cs.client_id
    where cs.active and cs.source = new.source and cs.client_id <> new.client_id and cs.id is distinct from new.id
      and public.mapping_norm_id(cs.source, cs.external_id) = public.mapping_norm_id(new.source, new.external_id)
    limit 1;
    if other is not null then
      raise exception 'mapping guard: % % is already mapped to %. Deactivate that mapping first, or set params.shared_ok if the account really is shared.',
        new.source, new.external_id, other;
    end if;
  end if;

  select * into disc from public.mapping_discovered_name(new.source, new.external_id);

  -- 2) discovery sees it but can't name it: someone must say what it's called on the platform
  if repointed and disc.found and disc.name is null and btrim(coalesce(new.params->>'name_verified','')) = '' then
    raise exception 'mapping guard: discovery can see % % but not its name, so the label can''t be checked. Open it on the platform and record what it is called in params.name_verified.',
      new.source, new.external_id;
  end if;

  -- 3) the label must look like the account it names
  if disc.name is not null and btrim(coalesce(new.params->>'label','')) <> ''
     and coalesce((new.params->>'label_override')::boolean, false) is false
     and not public.mapping_label_fits(new.params->>'label', disc.name) then
    raise exception 'mapping guard: label "%" shares no word with the account''s name on the platform, "%". Check the ID, or set params.label_override if the label is right.',
      new.params->>'label', disc.name;
  end if;

  return new;
end $$;

drop trigger if exists guard_client_source on public.client_sources;
create trigger guard_client_source before insert or update on public.client_sources
  for each row execute function public.guard_client_source();

create or replace view public.v_mapping_identity_issues with (security_invoker = true) as
select cs.id, c.slug, cs.source, cs.external_id, cs.params->>'label' as label, d.name as discovered_name,
       case when d.name is null then 'unnamed' else 'label_mismatch' end as issue
from public.client_sources cs
join public.clients c on c.id = cs.client_id
cross join lateral public.mapping_discovered_name(cs.source, cs.external_id) d
where cs.active and d.found
  and ((d.name is null and btrim(coalesce(cs.params->>'name_verified','')) = '')
    or (d.name is not null and btrim(coalesce(cs.params->>'label','')) <> ''
        and coalesce((cs.params->>'label_override')::boolean, false) is false
        and not public.mapping_label_fits(cs.params->>'label', d.name)));

grant select on public.v_mapping_identity_issues to authenticated;

-- the account this was written for: verified by its campaigns, 2026-11-03
update public.client_sources
   set params = params || jsonb_build_object('name_verified', 'Online Orchards (only campaign Fruit Trees; conversion Online Orchards - GA4 purchase) — checked 2026-11-03')
 where source = 'google_ads' and external_id = '4555222407';
