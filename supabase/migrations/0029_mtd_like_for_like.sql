-- 0029 (applied live 2026-08-05): client_prev_partial(slug, prev_month, days) —
-- agg-aware prior-month aggregation truncated to the first N days, so an
-- in-progress month is compared like-for-like instead of against a FULL prior
-- month. The client page calls it only when the selected month is the current one;
-- headers state the basis ("first N days vs the same N days last month").
-- Example of the bug it fixes: Contingent Meta spend Aug 1–4 = $4,086.76 read as
-- −83% against full July ($23,439) when the honest comparison is Jul 1–4
-- ($2,704) = +51%.
select 1; -- marker
