-- 0019 (applied live 2026-07-31): report_pack(slug, 'YYYY-MM') -> jsonb.
-- The stable one-call contract for report-generating skills (see
-- .claude/skills/client-report-deck): metrics vs prior month, campaigns, computed
-- metrics with formulas, goals, monthly trend series, provenance. Values verbatim
-- from the monthly views; consumers must not re-derive rates. Full definition
-- applied via Supabase migration `report_pack`. EXECUTE: authenticated only.
select 1; -- marker
