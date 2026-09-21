# Reporting reliability rollout

Branch: `codex/reporting-reliability`.

## Code changes

- Trends use source/account/metric identity and a 12-month horizon ending at the selected month. Partial months are gaps, not apparent declines.
- MTD comparisons use first N closed calendar days in both periods, capped to the length of the prior month. Every comparison requires full per-metric coverage; sparse metrics deliberately receive no percentage verdict.
- Derived comparisons recompute numerator and denominator from the same comparison rows and reject missing terms/accounts, incomplete coverage, and zero denominators.
- Queries request the chosen period, pagination checks exact counts, and failed report reads show a retryable error rather than fabricated empty results.
- Account probe matching normalizes Google Ads numeric IDs only.
- Computed metric creation uses one database transaction and unique catalog identities. Activation/depth changes check their results.
- Scoreboard prioritizes status then deadline. Report tables scroll on narrow screens; grid sorting uses buttons; mobile users can sign out.
- PR validation runs lint, regression tests, build, and runner syntax checks.

## Deployment prerequisites

Do not deploy the web changes alone: `create_derived_metric` must exist before the new settings action is used. Apply migration 0071 to a preview database first. Migration 0072 tightens the existing SQL account matcher without changing its signature.

The repository still lacks historical schema definitions. Comment-only / `select 1` migration markers are not executable equivalents of production. Neither a successful frontend build nor the isolated tests demonstrates clean database provisioning.

Required before merge/deployment:

1. Read the deployed schema and applied migration history through Supabase; recover exact definitions, policies, grants, extensions, and jobs into a versioned baseline. Exclude secrets and business data.
2. Confirm the production `client_prev_partial` definition accepts any supplied month and returns first-N-calendar-day values with distinct day counts. The new code calls it for both current and previous months. Confirm its row grain matches `v_client_monthly` and its output supports ordered/paginated RPC reads.
3. Confirm the ordering columns and uniqueness of the monthly, campaign, event, drill, lead-source, and query views against the recovered schema. Run period-filtered query contract checks in preview.
4. Recreate an isolated database from the baseline, then apply 0071/0072. Test atomic rollback, admin/member permissions, and existing formula/goal behavior.
5. Verify authenticated report rendering, refresh/retry, mobile navigation, and Supabase session refresh in preview. The existing Supabase SDK emits an Edge Runtime warning for guarded `process.version` runtime metadata; no authentication code has been removed or bypassed to suppress it.
6. Reconcile a complete and an incomplete report with platform exports before deploying.

## Deliberately pending

Cross-device, per-client KPI preferences need the recovered database baseline before adding profile storage and policies. The full orchestrator adapter split and on-demand campaign child loading are follow-up refactors; only account identity was extracted here.

## Local checks

From `web/`: `npm ci --ignore-scripts`, `npm run lint`, `npm test`, `npm run build`.
From repo root: `node --check orchestrator/run.mjs`, `git diff --check`.

No production migrations, source re-pulls, emails, or data writes were performed by this change.
