# Database report aggregation and complete exports

Reports now aggregate authorized source rows inside PostgreSQL before returning results. This replaces the former raw-source loader ceilings; overview totals, charts and report tables no longer depend on downloading every task, time log and tracking session into the browser. Rejected tasks have their own status chart category.

All four tables page through 50 rows at a time. CSV exports stream every table page through the API and only offer a download after the complete response arrives. PDF exports fetch every page before rendering. Both retain current-identity/range cancellation checks. CSV cells retain spreadsheet formula protection.

## Rollout

PRs #118, #119 and #120 are merged. Their earlier database prerequisites must already be installed.

1. Merge this release PR.
2. In the correct Supabase project's SQL Editor, run the complete file once:
   [20260912124428_production_scalable_report_aggregates.sql](https://github.com/zohaibsundrali/Developer-Activity-and-Productivity-Tracking/blob/main/supabase/migrations/20260912124428_production_scalable_report_aggregates.sql).
3. Deploy the matching web release immediately after the migration. No desktop rebuild is needed.
4. Open Reports with a permitted owner/admin/manager/team lead, then verify a permitted custom override and an explicit denial. Check a restricted plan and a second organization. Compare overview totals, each table's final page, and a complete CSV/PDF with known source records.

The new RPC is additive and compatible with the old UI during rollout. The new UI requires it; a missing RPC produces a retryable report error rather than partial totals. Do not replay older migration bundles to install this function.

## Data and authorization contract

`report_data(date,date,text,integer,integer)` is SECURITY INVOKER, executable by authenticated callers only. It checks the verified organization, typed identity, effective report permission and reports plan entitlement. All underlying source RLS, including time-log identity and tracking-history restrictions, remains effective. The typed time-log read policy evaluates stable caller identity and permission helpers once per SQL statement instead of repeating them for every row; its visibility conditions are unchanged. Service credentials only check the authenticated organization's billing in the API; report data uses the caller JWT.

Dates use UTC with an exclusive next-day upper bound. Existing semantics are preserved: task/project summaries describe all visible tasks/projects, hours use the selected start-date range, and the detailed time table includes ended logs. Table hour totals sum rounded row hours. The 3,660-day chart computation guard is not a subscription limit.

## Verification and limits

Automated coverage includes caller/plan/input failures, receipt validation, table pagination, complete and interrupted exports, scope cancellation, CSV MIME checks and spreadsheet escaping. The isolated PostgreSQL fixture exercises more than 20,000 time logs, typed identity collisions, permission overrides, history restrictions and aggregate totals. In the isolated 20,002-log fixture, overview, final time page and team calls completed in approximately 1.3 seconds combined after statement-level permission caching. This is a local fixture measurement, not a hosted production benchmark. See the PR for final command results.

Pages use independent database snapshots. Count changes and duplicate identities abort full exports, but same-count concurrent edits are not a transactionally frozen snapshot. Export during a quiet period if an exact point-in-time artifact is required. CSV streaming avoids retaining raw source objects on the server; the browser still assembles file bytes and PDF rendering still uses browser memory. Hosted function timeouts and very large browser downloads require production-volume verification.

No production customer records were changed during development. Hosted role journeys, legacy missing-profile recovery and external provider verification remain separate deployment work.
