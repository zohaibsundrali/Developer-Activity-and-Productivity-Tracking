# Productivity identity, completeness and canonical recalculation

Project productivity previously defaulted an omitted developer filter to the viewer's ID, hiding other assignees from a project report. Typed administrator identities could also be mistaken for developer identities with the same UUID. Reads now preserve an optional project filter, use explicit typed personal subjects, recognize typed project roster/task assignments and paginate complete authorized sources. Database failures produce errors rather than successful zero totals.

Task status aliases follow the same canonical rules as boards and reports. A completed task whose punctuality has not been assessed has neutral contribution and displays “Not assessed.” The displayed on-time rate remains on-time completions divided by completed tasks. The saved weighted score remains the task-review formula: `(onTime - late + 0.5 * pending) / total * 100`, bounded to 0–100. These are distinct measures; labels now explain the difference.

Recalculation uses one database transaction. A database trigger derives cached counts and scores from actual tasks, and authenticated clients cannot write arbitrary metric rows. Existing trusted review writes retain their transactional integration. Organization reports and recalculation require the reports entitlement; typed own delivery metrics retain their separate permission. An explicit denial overrides a role default.

Dashboard and project modals invalidate old responses after identity, view, project, selection, close or unmount changes. Complete minimal rosters require a confirmed organization and permission. Errors and empty selections clear old metrics.

## Rollout

1. Merge PR #121 first and install its reporting migration if still pending. This branch contains that release.
2. Merge this productivity release.
3. Run this complete migration once in the correct Supabase SQL Editor:
   [20260912132120_production_canonical_productivity_recalculation.sql](https://github.com/zohaibsundrali/Developer-Activity-and-Productivity-Tracking/blob/main/supabase/migrations/20260912132120_production_canonical_productivity_recalculation.sql).
4. Deploy the matching web release. No desktop rebuild.
5. Verify a multi-assignee project without a developer filter, a personal developer view, an administrator personal view, and rapid project/modal switches. Check explicit permission denials, a reports-disabled subscription and a second organization. Re-test approval/rejection and recalculation using disposable staging records.

The migration does not bulk rewrite customer scores or change subscription/identity records. Existing cached values are corrected when a trusted review or authorized recalculation next writes them. Do not replay old bundles to install this migration.

## Evidence boundaries

Local API/helper tests cover scope, complete low-cap paging, canonical formulas, target validation, stale responses and failed transactions. Isolated PostgreSQL tests cover metric write restrictions, canonical derivation, typed/plan access and trusted task review; the PR records final test results.

Paginated reads are not one frozen transaction across requests; same-count concurrent edits remain possible. Complete detailed responses still use server/browser memory and need hosted production-volume testing. This release does not certify provider delivery, real desktop capture, all hosted role journeys or unresolved legacy identity recovery.
