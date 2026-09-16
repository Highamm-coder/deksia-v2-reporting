-- 0030 (applied live 2026-08-05): daily connection smoke test.
-- connection_probes (current state per client/source/account) + connection_probe_log
-- (history) + record_probe() returning a verdict: new_reachable | recovered |
-- newly_broken | unchanged. run.mjs probes EVERY mapping each night — including
-- INACTIVE ones — with a cheap metadata call (Meta act lookup, Page token exchange,
-- GA4 property get, CallRail company get; google_ads is push-based so freshness of
-- the last script post stands in). Alerts: active connection newly broken (24h
-- dedupe), inactive-but-reachable "parked on a stale reason" digest (72h), recovery.
select 1; -- marker
