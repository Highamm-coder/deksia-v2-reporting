-- 0064_same_account_id_join.sql — applied live 2026-09-16. Ten views joined client_sources to
-- fact-side rows with regexp_replace(external_id, '\D', '') = regexp_replace(account_ext_id, '\D', '')
-- (digit-normalised, for Google Ads ids written with or without dashes). Search Console ids are
-- URLs with no digits, so both sides normalise to '' and EVERY Search Console mapping of a client
-- matched EVERY Search Console series of that client: Contingent (4 properties) fanned out 4×,
-- Hatton Power 2×, and refresh_rollups() failed on mv_client_provenance's unique index
-- ("duplicate rows without any null columns") — rollups would have gone stale for all sources.
--
-- Fix: one definition of "same account id" — exact match first, digit comparison only when the
-- id actually has digits — and every affected view rewritten to use it. The seven plain views are
-- CREATE OR REPLACEd (column lists unchanged; grants and security_invoker preserved).
-- mv_client_provenance cannot be replaced: dropped with its only dependent public.v_client_provenance
-- and rebuilt with the same unique index, grants and security_invoker=true (see 0048).
-- Not touched: mv_pipeline_health (count(distinct) — no fan-out) and v_gads_backfill_progress
-- (google_ads only, compares to an already-digit cid).

set local work_mem = '96MB';

create or replace function public.same_account_id(a text, b text)
returns boolean
language sql
immutable
parallel safe
as $$
  select a = b
      or (regexp_replace(a, '\D', '', 'g') <> ''
          and regexp_replace(a, '\D', '', 'g') = regexp_replace(b, '\D', '', 'g'))
$$;
comment on function public.same_account_id(text, text) is
  'Mapping id ≙ series id: exact, or digit-normalised when the id has digits (Google Ads dashes). Never treats two digitless ids as equal.';

do $$
declare
  r record;
  olddef text;
  newdef text;
  pat constant text := 'regexp_replace\(cs\.external_id, ''\\D''::text, ''''::text, ''g''::text\) = regexp_replace\(([a-z_]+\.[a-z_]+), ''\\D''::text, ''''::text, ''g''::text\)';
  rep constant text := 'public.same_account_id(cs.external_id, \1)';
begin
  -- 1. plain views: replace in place
  for r in
    select c.oid, n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v' and n.nspname = 'public'
      and c.relname in ('v_client_breakouts','v_client_campaign_drill','v_client_campaigns',
                        'v_client_campaigns_all','v_client_events','v_client_monthly','v_client_report_detail')
  loop
    olddef := pg_get_viewdef(r.oid);
    newdef := regexp_replace(olddef, pat, rep, 'g');
    if newdef = olddef then raise exception 'same_account_id rewrite matched nothing in %.%', r.nspname, r.relname; end if;
    execute format('create or replace view %I.%I as %s', r.nspname, r.relname, newdef);
  end loop;

  -- 2. the provenance matview: rebuild
  olddef := pg_get_viewdef('private.mv_client_provenance'::regclass);
  newdef := regexp_replace(olddef, pat, rep, 'g');
  if newdef = olddef then raise exception 'same_account_id rewrite matched nothing in mv_client_provenance'; end if;
  execute 'drop materialized view private.mv_client_provenance cascade';   -- drops public.v_client_provenance
  execute 'create materialized view private.mv_client_provenance as ' || newdef;
  execute 'create unique index mv_prov_key on private.mv_client_provenance (slug, source, account_ext_id, account_label)';
  execute 'grant select on private.mv_client_provenance to authenticated, service_role';
  execute $v$
    create view public.v_client_provenance with (security_invoker = true) as
    select slug, source, account_ext_id, account_label, brand, method, api, cadence,
           first_day, last_day, last_ingested, rows, writers
    from private.mv_client_provenance
  $v$;
  execute 'grant select on public.v_client_provenance to authenticated, service_role';
end $$;
