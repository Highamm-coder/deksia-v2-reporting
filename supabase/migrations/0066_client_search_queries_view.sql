-- 0066_client_search_queries_view.sql — applied live 2026-09-16. Search Console top queries for the
-- client page. Full-depth Search Console mappings store the top queries per property per day as
-- "term:<query>" breakout series (clicks, impressions, ctr, position — 90-day horizon). This view
-- rolls them to query × month: clicks and impressions are summed (additive counts the platform
-- itself reports for any date range); ctr and position are the average of the daily values the
-- platform reported, labelled as such in the console and never summed (metric_definitions agg=avg).
-- Reads series + fact_daily directly (not metrics_daily) so it touches only search_console rows.
create or replace view public.v_client_search_queries
with (security_invoker = true) as
select c.slug,
       s.client_id,
       s.account_ext_id,
       coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(s.account_ext_id, '')) as account_label,
       substring(s.qualifier from 6) as query,
       date_trunc('month', f.metric_date)::date as month_start,
       sum(f.value) filter (where d.metric_name = 'clicks')      as clicks,
       sum(f.value) filter (where d.metric_name = 'impressions') as impressions,
       avg(f.value) filter (where d.metric_name = 'ctr')         as ctr_avg_of_days,
       avg(f.value) filter (where d.metric_name = 'position')    as position_avg_of_days,
       count(distinct f.metric_date)                             as days
from series s
join fact_daily f on f.series_id = s.series_id
join metric_definitions d on d.metric_id = f.metric_id
join clients c on c.id = s.client_id
left join client_sources cs on cs.client_id = s.client_id and cs.source = s.source
                            and public.same_account_id(cs.external_id, s.account_ext_id)
where s.source = 'search_console' and s.qualifier like 'term:%'
group by c.slug, s.client_id, s.account_ext_id,
         coalesce(cs.params ->> 'label', cs.params ->> 'account', nullif(s.account_ext_id, '')),
         substring(s.qualifier from 6), date_trunc('month', f.metric_date);

grant select on public.v_client_search_queries to authenticated, service_role;
