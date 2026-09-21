-- 0071_filter_breakouts_in_rollup_consumers.sql — applied live 2026-09-21.
--
-- THE BUG. private.mv_metrics_monthly_dim deliberately KEEPS ad:/ag: rows, because
-- v_client_campaign_drill is built on them (that is the campaign → ad set › ad expansion,
-- 767 rows for September alone). Its own WHERE only strips brk|term|kw|dev|net|age|gender,
-- which is NOT the canonical is_breakout() list — that also includes ad: and ag:.
-- Views that re-filter with is_breakout() are therefore correct (v_client_monthly,
-- v_client_campaigns_all). Views that trust the rollup silently double-count: an ad-level row
-- and its parent ad-group/campaign row are both summed.
--
-- Measured before this migration (Green Shield, September 2026, google_ads spend):
--   v_client_monthly (correct)                    $11,423.07
--   raw rollup sum, every qualifier               $22,012.82
--   of which ad:/ag: duplicate rows               $10,589.74
-- Blended CPL for Green Shield therefore read $160.24 instead of $93.22 (+71.9%).
--
-- LIVE consumers that were wrong:
--   • v_client_derived_all — Blended CPL on the client page (Derived.js). 20 clients, 9 months.
--   • v_client_derived     — the same metric inside report_pack(), i.e. the client-facing deck.
-- LATENT consumers fixed at the same time so they cannot become the next incident:
--   • v_client_campaigns     (superseded by v_client_campaigns_all, which filters correctly)
--   • v_client_report_detail (no consumer today — verified: not referenced by the app,
--                             report_pack, any view or any function)
-- Verified NOT contaminated, so left alone: v_client_events (conversion_action has zero
-- ad:/ag: rows) and v_client_lead_sources (callrail has none).
--
-- THE FIX. Filter at the point of use rather than in the rollup, so v_client_campaign_drill
-- keeps the ad-level rows it needs. Each view reads the rollup through an inline filtered
-- subquery — shape-independent, so no view's own WHERE/GROUP BY had to be rewritten by hand.
-- CREATE OR REPLACE VIEW drops security_invoker (see 0065), so it is re-asserted.

do $$
declare
  r        record;
  olddef   text;
  newdef   text;
  ref      constant text := 'private.mv_metrics_monthly_dim mv';
  filtered constant text := '(select * from private.mv_metrics_monthly_dim where not public.is_breakout(qualifier)) mv';
begin
  for r in
    select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and c.relname in ('v_client_derived', 'v_client_derived_all', 'v_client_campaigns', 'v_client_report_detail')
    order by c.relname
  loop
    olddef := pg_get_viewdef(r.oid, true);
    if position(ref in olddef) = 0 then
      raise exception '0071: %.% does not read the rollup as "%" — refusing to guess', 'public', r.relname, ref;
    end if;
    if olddef ilike '%is_breakout%' then
      raise notice '0071: % already filters breakouts, skipping', r.relname;
      continue;
    end if;
    newdef := replace(olddef, ref, filtered);
    execute format('create or replace view public.%I as %s', r.relname, newdef);
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
  end loop;
end $$;
