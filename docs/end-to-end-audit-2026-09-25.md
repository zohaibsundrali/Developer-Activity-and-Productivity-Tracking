# Verisade end-to-end audit — 25 September 2026

## Result

**Release sign-off is withheld.** The runnable audit covered all owner navigation sections, the available organization roles, representative live workflows, authorization boundaries, database contracts, and desktop/mobile builds. It found and reproduced defects; two database repairs are prepared and locally verified but **not applied to the connected database**. Payment configuration, annual billing, advertised Free entitlements, and public desktop distribution also remain unresolved.

This report distinguishes screen coverage from functional coverage. Opening every sidebar entry does not prove every control, data combination, external delivery, or operating system works. The 41/13/12/12/9 figures describe navigation configurations, not independent modules or a complete test count. Current organization roles number 11; the former admin QA identity is now a co-owner. A separate platform console has its own access model.

The audit used production builds on local ports 3131 (baseline), 3132 (first fixes), 3133 (assignment/error-handling fixes), and 3134 (including Kanban persistence), connected to the existing Supabase project. Live writes were confined to explicit synthetic QA organizations/accounts. No real payment was charged, public GitHub data was only read, and no real customer email was sent. Application source and new database migrations remain local, uncommitted and undeployed.

## Reproduced defects and repairs

| Finding | Repair / status | Evidence |
| --- | --- | --- |
| Owner-assigned tasks were mislabeled or grouped as unassigned, and assignee filters ignored owners | **Fixed in source.** Shared typed assignment lookup is used in Kanban, List, Table, Workload, sprint board and sprint planning. Admin/developer identities with the same UUID remain distinct. Older saved developer UUID filters remain supported. | Unit and rendered-view regressions; live final-build browser checks for four views, unassigned/owner filters and saved-filter reload. |
| Saved-view load failures were silently treated as empty results; zero-row updates/deletes could appear successful | **Fixed in source.** Require organization context, propagate read errors, scope mutations, verify affected IDs, and recover from thrown errors without leaving the Delete button stuck. | Regression tests for denied reads, zero-row/mismatched mutations and missing context; live browser simulates a zero-row DELETE and verifies the selected view remains. |
| Saving the default Kanban view violated the live database view-type constraint | **Fixed in source.** Translate the UI type `kanban` to persisted `board` on writes and back to `kanban` on reads. Other view types retain their existing values. | Live raw insertion reproduced SQLSTATE `23514`; seven contract regression cases pass. All six view types save and restore the correct tab in the final live browser run. |
| Circular blocking task dependencies are accepted by the live database | **Migration prepared; live defect remains.** Normalize `blocks`/`blocked_by` directions, reject self/circular edges, inspect hidden edges through a private non-callable trigger, serialize competing edits. Ordinary `relates_to` links remain allowed. Existing records are preserved. | Live reproduction in `planning-workflows.cjs`; local SQL tests for reverse/transitive/mixed-direction cycles, hidden edges, changes of relationship type and multi-row rollback; two overlapping database sessions commit one edge and reject the reverse. |
| A staff member can read another person's `is_shared=false` saved view in the same organization | **Migration prepared; live defect remains.** Restrictive policies enforce typed ownership for personal reads and all edits/deletes. Shared views remain readable by internal staff. Insert identity is stamped and ownership is immutable. | Independent live reproduction in `saved-view-privacy.cjs`, also reproduced in planning; local SQL verifies owner CRUD, same-UUID/different-type isolation, other staff, client and foreign-organization denial, shared read-only access, spoofing denial and legacy backfill. |
| Live planning operations intermittently returned PostgreSQL `57014` statement timeouts | **Observed, unresolved root cause.** Earlier attempts failed during checklist or saved-view writes; the final run completed those operations and reached the expected two defects above plus the completed-sprint check. | Original and retry logs retained. A successful rerun does not erase the reliability finding; investigate hosted database query/lock telemetry. |

Prepared migrations:

- `supabase/migrations/20260925072952_task_dependency_cycle_guard.sql`
- `supabase/migrations/20260925074540_saved_view_owner_isolation.sql`

The saved-view migration backfills profile type only when membership ownership is unambiguous. Ambiguous/orphaned personal rows are retained and become inaccessible until their owner is verified; review these before deployment. Neither migration repairs or deletes existing circular dependencies. After authorized database deployment, rerun both live reproductions and inspect existing data. Database-management SQL access was denied by the connected tool; this is separate from the successful Data API QA tests.

The trigger approach follows the [Supabase trigger documentation](https://supabase.com/docs/guides/database/postgres/triggers). The current changelog was checked. Local SQL fixtures validate the actual migration files, not replacement mock functions for the guards under test.

## Execution results

| Layer | Result and practical limit |
| --- | --- |
| Unit tests | **5,295 passed / 286 files.** Includes 20 new assignment/rendering/saved-view regressions. |
| Production build | **Passed**, including lint/type checks and static generation. **31 existing lint warnings** remain, largely hook dependency/ref cleanup warnings. |
| Full baseline Chromium suite | **113 passed, 13 skipped, 5 failed** (131 collected, 45.8 minutes). All five failures were stale assertions/probes and passed focused reruns after corrections. Baseline uses the original production bundle; focused tests exercise the repairs. |
| Corrected navigation/security suite | **13 passed** on the rebuilt app, including owner and co-owner sidebar walks and anonymous API boundaries; **2 workspace tests and 1 developer-dashboard test also passed** after updating obsolete login/dashboard selectors. |
| Final project-view browser test | **13 checks passed** on the final build: owner/unassigned filters, four assignee presentations, all six view types saved/reopened with the correct tab, saved-filter reload and denied-delete recovery. |
| Role/API matrix | **319 checks passed**, covering 11 organization roles and expected permission denials. |
| Tenant REST isolation | **210 checks passed across 105 tenant tables/views**, probing anonymous and foreign-organization access. Only **23 tables had QA rows**; empty-table negative results are weaker evidence. This does not detect same-tenant personal-view leakage, which was tested separately and failed. |
| Live workflow batches | All nine original workflow scripts passed: role matrix, general HR/business records, task lifecycle, time workflows, invoice lifecycle, client workflows, device presence, owner work APIs, and owner work browser. |
| GitHub integration | Passed public repository linking, authorization/version denials, real issue preview/import, idempotent replay, sync/stale conflicts and unlink. Initial fixture picked from a PR-only list; switched the fixture to an issue-specific search. No GitHub writes. |
| Planning extension | Project/sprint/epic/story-point persistence, activation, tenant denial, checklist/comment persistence and completed-sprint rejection passed. Circular dependencies and personal-view privacy **failed on the live database**. |
| PostgreSQL contract/concurrency suite | Existing full isolated suite passed. Additional actual-migration fixtures and concurrent dependency test passed in disposable PostgreSQL 16 containers. No live DDL. |
| Desktop tracker | **225 passed, 1 Windows-only skipped** out of 226 unittest cases. Linux test environment does not establish Windows/macOS capture, permissions or installer acceptance. |
| Android | Debug assembly, lint and fresh unit task passed; **9 unit tests passed**. Lint: **0 errors, 13 warnings**. Real-device GPS, permissions, background restrictions and distribution remain unverified. |
| Organization browser | Mocked API suite passed at 1440/768/390px, including workspace switching and split signup/retry behavior. Does not prove actual email delivery. |
| Platform browser | Mocked lifecycle, billing/refund, member, MFA, support and mobile scenarios passed. Positive live platform administration/payment actions were not exercised. |
| Marketing browser | Passed at 1440/390px: theme behavior, pricing toggle/comparison scrolling, contact UI, split registration/terms and SPA download navigation. This does not prove billing or installer delivery. |

The 13 baseline skips were eight explicitly disabled seed/setup tests, four staff-manager cases inapplicable to the admin-based manager fixture, and one feedback display case with no reviewed task in its seed. The separate live task lifecycle checks do not substitute for that missing browser state.

Test maintenance corrected obsolete assumptions: the old admin QA account is a co-owner; protected platform handlers need valid action/dataset inputs to reach authentication; sign-in no longer has a role picker; and the developer dashboard now summarizes tasks rather than showing the old Total projects metric. The anonymous probe still requires 401/403; it was not weakened to accept arbitrary validation responses. Signup browser/source assertions were updated for the already implemented multi-part registration flow.

## Module coverage and remaining limits

| Functional area / screens | What was exercised |
| --- | --- |
| Overview, account, authentication, permissions, organization | Role login/logout, direct route denial, effective permissions, override/reload behavior, directory/navigation, teams/departments, mocked workspace switching and signup. Real mail delivery and provider recovery still require acceptance checks. |
| Project hub, all/my projects, board/views, sprints, epics, capacity | Owner section walks, project detail and task data, typed assignment/filtering, four view render checks, saved filter persistence, planning persistence and completed-sprint guard. Two database defects above remain live. |
| My Work, task reviews, submissions | Real create/delegate/reassign, submission/review/approval/rejection and typed ownership workflows; owner and delegated-away browser behavior. |
| Activity, team stats, reports, system health | Navigation/report tabs, authorized read routes, desktop unit coverage and device presence workflows. Real OS capture and long-running ingestion under production load are not certified. |
| Timesheets, approvals, payroll preparation | Real time entry/submission/approval, billing-source ownership and related SQL/concurrency checks; payroll screens/API guards. Payroll preparation is not a verified external payroll transfer. |
| Attendance, shifts, mobile field work, leave/approvals | Live scheduling, clock/leave/timesheet/mobile workflows plus isolated overlap/replay/concurrency checks; Android build/unit checks. Physical geofence/GPS and background behavior require a device. |
| Quality/testing, bugs | Browser test case/run creation and result/bug surfaces, role restrictions, SQL and unit contracts. |
| Employees, team structure, recruitment, performance/reviews | Directory/forms, reporting lines, role-denied controls, real candidate/performance/related record workflows, strict date validation. No actual onboarding mail sent. |
| Assets/licences, contracts/milestones | Live valid creation/update workflows, invalid-date rejection, role permissions, fixture cleanup. |
| Clients, requests, change requests, invoicing | Client project isolation, representative client request/proposal/invoice workflows, document permissions and internal invoice lifecycle. Actual outgoing invoice email/payment collection not exercised. |
| Automation, reminders, recurring tasks | UI/API role boundaries and unit/SQL contracts. Cron deployment, real delivery and Free-plan entitlement mismatch remain release checks. |
| Subscription billing, trials, Enterprise contact | Billing screen, backend/unit contracts and mocked platform cases; contact UI. Live payment processing and actual sales email delivery are not established. |
| Desktop download and Android distribution | Download SPA/UI, desktop logic and Android build checks. Public desktop release configuration is absent; release/signing/device installation remain outstanding. |

## Release blockers outside the source fixes

1. **Payments are not configured in this environment.** Stripe secret/webhook keys are absent and all four live catalogue rows have no Stripe price ID. No successful paid checkout or real webhook round trip can be claimed.
2. **Annual pricing is presentation-only.** Marketing displays $39/$119 monthly equivalents for annual Professional/Business billing; checkout selects a single monthly plan price and has no annual selection path. Configure interval-specific prices and carry the selected interval through registration/upgrade/checkout before advertising it as purchasable.
3. **Free plan features disagree with marketing.** The comparison table includes reports, automation, reminders and recurring tasks for Free, while the live catalogue disables reports/automation and the corresponding backend guards enforce those flags. Align entitlements and tests with the intended commercial policy. This audit did not silently change all organizations' live entitlements.
4. **Public desktop release is absent.** `DESKTOP_PUBLIC_RELEASE` is unset. A working download UI and passing tracker tests do not provide an approved installer to users. Publish/verify the intended installers and configure the manifest.
5. **Apply and verify the two database repairs.** Both defects are reproduced live; local migrations alone do not close them. Review legacy ownership and existing dependency data before sign-off.
6. **Investigate hosted timeouts and warnings.** Keep the two observed planning timeouts in the reliability backlog. Browser coverage is Chromium-only; no load/soak test, live database advisor refresh, or real-device acceptance is included.

## Evidence and rerun paths

- Static inventory: [qa-feature-inventory.json](qa-feature-inventory.json); generated with `node scripts/generate-qa-inventory.cjs`. Final inventory: 30 pages, 114 API route files, 1,138 controls, 57 forms, 11 organization roles, 103 permissions, 128 SQL fixtures, 110 migrations and zero parse errors. It inventories source controls and tests, not execution coverage.
- Private local artifacts: `artifacts/audit-20260925/` contains logs, browser reports/traces, workflow results and cleanup evidence. This directory is ignored by Git because browser traces can contain authenticated sessions.
- Unit/build: `npm test`; `NEXT_DIST_DIR=.next-audit-release npm run build`.
- Existing database suite: `bash scripts/test-audit-policies.sh`.
- New database fixes: `bash scripts/test-task-dependencies.sh` (dependency fixture/concurrency and saved-view isolation fixture).
- Focused browser: `scripts/qa/project-views-browser.cjs` against the final running build, with existing synthetic QA credentials and explicit `E2E_ALLOW_WRITES=1`.
- Live defect checks after migration deployment: `scripts/qa/planning-workflows.cjs` and `scripts/qa/saved-view-privacy.cjs`.
- Cleanup verification: `scripts/qa/verify-cleanup.cjs` with `QA_ARTIFACT_DIR` pointing to the run's workflow folder. The first verification checked 32 recorded temporary objects and found zero remaining; final-build cleanup also verified its additional project was removed. Existing idempotent browser seed records are intentionally retained.
