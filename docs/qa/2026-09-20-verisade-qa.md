# Verisade QA — 20 September 2026

This audit uses three independent QA agents plus a coordinating agent. Baseline: `f1e7ca0`. Passing a mock, source contract, or isolated database test is not certification of the deployed application. The user chose local/mocked QA only during the run. Production end-to-end acceptance remains open.

## Executed evidence

| Check | Result | Boundary |
| --- | --- | --- |
| Baseline web suite | 270 files / 5,165 tests passed | Unit, API mocks and source/schema contracts |
| Combined application fixes, including pending Support activation | 276 files / 5,231 tests passed | Includes new pagination, task-state, billing, export, support and auth regression cases |
| Final safe main release | 276 files / 5,229 tests passed | Excludes pending Support activation; includes later QA fixture environment/organization checks |
| QA fixture isolation/routing | 21 tests passed | Explicit private run file, exact organization pin and automatic role destinations; included in final full-suite total |
| Production build | Passed for combined fixes and final safe main release | Existing lint warnings remain |
| Login production browser | Passed | Desktop/mobile height, accessible inputs, automatic-role form, dark colors; no real account creation |
| Developer production browser | Passed | Mocked task/time data, refresh, unavailable/retry state, My Work navigation, dark sidebar/logo, mobile width |
| Platform production browser scripts (2) | Passed | Mocked owner/limited-role/MFA/provider responses; management actions, exports, analytics, confirmations and mobile layout |
| `scripts/test-audit-policies.sh` | Passed, exit 0 | Disposable PostgreSQL 16; RLS, tenant/type isolation, transactions, quotas, lifecycle and concurrency |
| `database/tests/platform_suite.sql` | Passed | Actual platform SQL permissions/transactions in disposable PostgreSQL 16 |
| `database/tests/client_support_transactions.sql` | Passed; migration rerun passed | Injected failures roll back thread/message pairs; actor/tenant and RPC grants checked |
| Desktop tracker suite at `3909383` | 226 run: 225 passed, 1 skipped | Dependency-complete Python environment; Windows message-loop test requires Windows |

Overlapping agent subset runs are not added to the unique full-suite total. Initial Python failures came from using an interpreter without dependencies; the final run above used the existing isolated desktop environment.

## Coverage matrix

| Requested area | Exercised coverage | Remaining real acceptance |
| --- | --- | --- |
| Login and organizations | Account-type routing, session expiry/logout, verified identity linkage, membership, workspace isolation, signup/invite/reset recovery contracts; login browser layout | Fresh role accounts, actual organization switching, delivered verification/invite/reset email |
| Platform owner | Stats, member/project/organization actions, restricted roles, audit and live-session guard; SQL transactions and mocked browser flows | Real suspend/reactivate/revoke effects and complete destructive cleanup on disposable data |
| Platform billing | Scope, plan/trial/cancel/refund request validation, idempotency, reconciliation; correct churn formatting | Stripe test-mode settlement, webhook delivery and subscription mirror convergence |
| Platform controls | Filters, invalid dates, all-page CSV/PDF exports, incomplete-report refusal, health/alerts, MFA and role gates | Real MFA assurance, production audit persistence, provider/job recovery |
| Organization management | Employees, roles, field permissions, typed teams/members, hierarchy and settings regression contracts | New seeded organization and each real role's browser actions |
| Projects and tasks | Assignment, board links/views, sprints, review/status transitions, planning, quality/bugs, transactional decisions and races | Full fresh owner/developer/client browser lifecycle |
| Developer | Dashboard urgency/time, own projects/work, timesheets, reviews/activity and identity scoping | Installed tracker-to-browser duration reconciliation and real task submission |
| Tracking | Pause/resume/breaks, screenshots/policy, activity/input queues, recovery, device sessions/presence; web SQL and desktop tests | Physical Windows capture, reboot/offline recovery, hosted Storage and OS permissions |
| HR and operations | Attendance concurrency, shifts/overlaps, leave, performance, recruitment, assets/capacity and approved-hours export | Real device clock/GPS and role-specific HR workflows; salary payouts are not included |
| Client portal | Project visibility, complete project/task/approval/attachment reads, task progress, proposals/invoices/privacy, atomic support fixture | Fresh client login, delivered messages/provider invoices; support SQL activation |
| Reports and integrations | Date/attribution/status consistency, CSV/PDF, GitHub import/manual refresh and automation recovery contracts | Private GitHub provider acceptance, scheduled production jobs and external delivery |

## Confirmed bugs corrected

1. Churn percentage was multiplied twice: database 5% could render 500%.
2. Impossible analytics dates reached SQL instead of receiving an input-validation response.
3. Platform export could return a successful but incomplete report after missing counts, count drift, duplicates or short reads.
4. Client summaries treated rejected tasks as closed instead of returned work.
5. Client project lists/details silently truncated large task, approval and attachment collections. Reads now retain tenant/visibility constraints, paginate with exact counts and bound ID-filter sizes. Excessive/unreliable results fail explicitly.
6. Client authorization project links stopped at the REST row cap. The scope loader now reads all verified links and fails closed on incomplete/foreign/duplicate data.
7. Support thread/message and reply/activity updates were separate writes. The tested atomic replacement requires the new SQL migration before route activation.
8. A failed optimistic support reply discarded its draft. The draft is restored unless the user has already typed a new one.
9. QA login defaults/selectors and setup documentation described the previous role-tab flow. They now match automatic routing, required-field accessible labels and isolated fixture files.

Paginated reads are not a transactional snapshot: same-count edits during collection can still span different instants. The new checks prevent known incomplete/unstable-page failures; they do not claim snapshot isolation.

## Real-account findings and deployment blockers

Existing saved QA credentials were exercised against the actual configured backend through the local application. The old developer account authenticated, but its profile's Auth link did not match that verified identity. The saved owner/client profiles were missing while active membership references remained. The owner's login reached Organizations with zero accessible workspaces. These are stale QA fixtures, not evidence that role checks should be bypassed. No existing identity was relinked or guessed.

The first broad role run also exposed stale test selectors and was stopped; it is not counted as successful feature coverage. The corrected developer/owner smoke runs confirmed the fixture blockers above. Fresh disposable seeding is tracked separately below.

Local configuration checks found missing Stripe secret/webhook secret, cron secret and application origin. Mail configuration was present but delivery was not exercised. This only describes the inspected local environment, not Vercel's settings.

Read-only REST schema inspection confirmed both new support RPCs are absent in the configured live project. The user confirmed the SQL has not been run. The two support route changes are therefore held in a separate local activation commit and are NOT included in the main release. Apply `supabase/migrations/20260920174850_client_support_transactions.sql` before activating them. The migration adds service-role-only invoker functions and preserves existing records. Do not run the test fixture in production.

## Fresh disposable QA attempt

Before the local-only instruction, the isolated local application connected to the configured real backend and created two uniquely named disposable Business-trial QA organizations (A/B). Email and Stripe credentials were explicitly empty. The seed was stopped with exit 130 immediately when the user chose local/mocked QA only. The private run file records no completed new role accounts, projects or tasks. A first staff-creation attempt had started, so its partial result remains unverified; no further live reads were made to investigate it. Both organizations were retained, with no cleanup or existing-identity repair. No real payment or email delivery was performed. The incomplete seed scripts are private local artifacts and are not shipped as verified tests.

## Reproduction

- Web: `npm test -- --reporter=dot`
- Build: `npm run build`
- Mocked browser: set `E2E_BASE_URL` to the local app and run `scripts/test-login-presentation.cjs`, `scripts/test-developer-overview-browser.cjs`, `scripts/test-platform-browser.cjs`, `scripts/test-platform-suite-browser.cjs` with Node.
- Database: `bash scripts/test-audit-policies.sh`; run platform/support fixtures only in a disposable PostgreSQL database.
- Real role tests: use a dedicated `E2E_ENV_FILE`, set `E2E_ALLOW_WRITES=0`, and select the role/isolation specs. Do not blindly rerun the older seed script against stale credentials.

Raw browser traces and environment files are private local artifacts; they are not committed because they may contain authentication material or account data.

## Pending activation artifact

The tested Support route switch is retained locally as commit `d8b6c2b` on `qa/support-transactions-pending-sql`, also exported to `/tmp/verisade-support-activation.patch`. It is deliberately not pushed to main. After SQL installation is confirmed, apply that isolated commit on top of the latest main and rerun its focused API tests before deployment. No other released fix depends on the new functions.
