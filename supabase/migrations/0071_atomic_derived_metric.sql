-- Apply after the recovered production baseline. No production deployment is implied.
-- One transaction: a failed catalog registration cannot leave an orphan formula.
create or replace function public.create_derived_metric(
  p_slug text, p_global boolean, p_label text, p_unit text,
  p_numerator jsonb, p_denominator jsonb
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  client uuid;
  formula uuid := gen_random_uuid();
  metric text;
  terms jsonb;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Admins only'; end if;
  select id into strict client from public.clients where slug = p_slug;
  if nullif(btrim(p_label), '') is null or p_unit is null or p_unit not in ('usd','ratio','pct','int') then
    raise exception 'Invalid label or unit';
  end if;
  foreach terms in array array[p_numerator, p_denominator] loop
    if terms is null or jsonb_typeof(terms) <> 'array' then raise exception 'Terms must be arrays'; end if;
    if jsonb_array_length(terms) = 0 then raise exception 'Formula requires terms'; end if;
    if exists (
      select 1 from jsonb_array_elements(terms) t
      where not exists (select 1 from public.metric_definitions d
        where d.source = t->>'source' and d.metric_name = t->>'metric' and d.agg = 'sum')
    ) then raise exception 'Only registered additive metrics may be terms'; end if;
    if (select count(*) <> count(distinct t) from jsonb_array_elements(terms) t) then
      raise exception 'Duplicate formula terms';
    end if;
  end loop;
  -- Global catalog names must not collide between client-scoped formulas.
  metric := 'custom_' || replace(formula::text, '-', '');
  insert into public.metric_definitions(source, metric_name, unit, direction_default, agg, description, provenance)
    values ('derived', metric, p_unit, case when p_unit = 'usd' then 'decrease' else 'increase' end,
      'avg', btrim(p_label) || ' — Deksia-computed formula', 'Deksia-computed (ratio of platform sums)');
  insert into public.derived_metrics(id, client_id, name, label, unit, numerator, denominator)
    values (formula, case when p_global then null else client end, metric, btrim(p_label), p_unit, p_numerator, p_denominator);
  return formula;
end $$;
revoke all on function public.create_derived_metric(text, boolean, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_derived_metric(text, boolean, text, text, jsonb, jsonb) to authenticated;
