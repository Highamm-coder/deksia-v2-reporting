-- 0016: goals can target Deksia-computed metrics (e.g. "Blended CPL under $45").
-- Each derived metric registers a metric_definitions row under source='derived'
-- (satisfies the goals FK and auto-appears in the goal editor's picker, agg='avg' =
-- level semantics). run_goal_tracker gains a 'derived' branch: current value =
-- ratio-of-sums of the formula's terms over the goal window — same math as
-- v_client_derived, platform-faithful inputs only.

-- register existing derived metrics (and template for future ones — the console's
-- addDerived action upserts this row on creation)
insert into public.metric_definitions (source, metric_name, unit, direction_default, agg, description, provenance)
select 'derived', dm.name, dm.unit,
       case when dm.unit = 'usd' then 'decrease' else 'increase' end,
       'avg',
       dm.label || ' — Deksia-computed formula',
       'Deksia-computed (ratio of platform sums) — not a platform-reported number.'
from public.derived_metrics dm
on conflict (source, metric_name) do nothing;

create or replace function public.run_goal_tracker(p_as_of date default (now() at time zone 'America/New_York')::date)
returns table (goals_processed int, snapshots_written int)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  g            record;
  v_agg        text;
  v_current    numeric;
  v_total_days int;
  v_elapsed    int;
  v_expected   numeric;
  v_required   numeric;
  v_actual     numeric;
  v_projected  numeric;
  v_pct        numeric;
  v_abs        numeric;
  v_status     text;
  v_cumulative boolean;
  v_at_due     boolean;
  v_numj       jsonb;
  v_denj       jsonb;
  v_num        numeric;
  v_den        numeric;
  n_goals      int := 0;
  n_snaps      int := 0;
  ins          int;
begin
  for g in select * from public.goals where active loop
    n_goals := n_goals + 1;
    select coalesce(agg,'sum') into v_agg
      from public.metric_definitions where source=g.source and metric_name=g.metric_name;
    v_agg := coalesce(v_agg,'sum');
    v_cumulative := (v_agg = 'sum');
    v_total_days := greatest((g.due_date - g.start_date) + 1, 1);
    v_elapsed := greatest(least(p_as_of, g.due_date) - g.start_date + 1, 0);
    v_at_due := (p_as_of >= g.due_date);

    if g.source = 'derived' then
      -- Deksia-computed goal: evaluate the formula (client-scoped def wins over
      -- global) as ratio-of-sums over the goal window. Level metric, never cumulative.
      v_numj := null; v_denj := null; v_current := null;
      select dm.numerator, dm.denominator into v_numj, v_denj
        from public.derived_metrics dm
       where dm.name = g.metric_name and dm.active
         and (dm.client_id = g.client_id or dm.client_id is null)
       order by dm.client_id nulls last limit 1;
      if v_numj is not null then
        select coalesce(sum(md.value), 0) into v_num
          from public.metrics_daily md
          join jsonb_array_elements(v_numj) e
            on (e->>'source') = md.source and (e->>'metric') = md.metric_name
         where md.client_id = g.client_id
           and md.metric_date between g.start_date and least(p_as_of, g.due_date);
        select coalesce(sum(md.value), 0) into v_den
          from public.metrics_daily md
          join jsonb_array_elements(v_denj) e
            on (e->>'source') = md.source and (e->>'metric') = md.metric_name
         where md.client_id = g.client_id
           and md.metric_date between g.start_date and least(p_as_of, g.due_date);
        v_current := case when v_den <> 0 then v_num / v_den end;
      end if;
      v_cumulative := false;
    else
      select case v_agg
               when 'avg'  then avg(value)
               when 'last' then (array_agg(value order by metric_date desc))[1]
               when 'max'  then max(value)
               when 'min'  then min(value)
               else sum(value) end
        into v_current
        from public.metrics_daily
       where client_id=g.client_id and source=g.source and metric_name=g.metric_name
         and metric_date between g.start_date and least(p_as_of, g.due_date);
    end if;

    if v_current is null or v_elapsed <= 0 then
      v_pct:=null; v_abs:=null; v_required:=null; v_actual:=null; v_projected:=null; v_status:='pending';
    else
      v_abs := v_current - coalesce(g.baseline_value,0);
      if g.direction='increase' then
        v_pct := v_current / nullif(g.target_value,0);
      else
        v_pct := g.target_value / nullif(v_current,0);
      end if;

      if v_cumulative then
        v_expected := g.target_value * v_elapsed::numeric / v_total_days;
        v_required := g.target_value / v_total_days;
        v_actual   := v_current / nullif(v_elapsed,0);
        v_projected:= v_actual * v_total_days;
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
    get diagnostics ins = row_count;
    n_snaps := n_snaps + ins;

    update public.goals
       set status=v_status, current_value=v_current, pct_to_target=v_pct,
           projected_value=v_projected, last_computed_at=now()
     where id=g.id;
  end loop;

  goals_processed := n_goals; snapshots_written := n_snaps; return next;
end $function$;
