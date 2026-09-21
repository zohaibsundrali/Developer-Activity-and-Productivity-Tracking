# Verisade QA — 21 September 2026

For the subsequent deep audit, additional repairs and current verification limits, see [the latest report](qa-deep-audit-2026-09-21.md).

## Repair status

The initial findings below are historical. Repairs completed on 21 September:

- Restored nine synthetic staff Auth links using the audited repair RPC and four
  missing synthetic profiles after verifying typed memberships and Auth claims.
  All 13 identity preflights now return correct role permissions with HTTP 200.
- Applied all seven missing 14 September feature migrations and the 20 September
  shared-account billing migration, with atomic migration-history records.
  The initial 15 readiness objects are present; public tables have RLS.
  A broader audit found four more missing migrations: transactional typed
  invoicing, attendance, report aggregates and productivity recalculation. All
  four passed their isolated SQL fixtures and were applied (12 feature migrations total).
- Backed up existing function definitions and subscription rows privately before
  applying changes. Shared billing preflight found no conflicting subscriptions.
- SQL contracts passed for shifts, attendance exceptions, approved exports,
  project GitHub links, issue import/sync, mobile tracking and shared billing.
  Relevant concurrency checks passed, including combined workspace billing quotas.
- Refreshed expired trial windows only for QA Test Org A/B, after confirming all
  14 members are synthetic and neither organization has a Stripe customer or
  subscription. Test trials now expire 28 September; real subscriptions unchanged.
- Restricted five invitation management RPCs to service_role, explicitly removing
  anon/authenticated grants; transactional assertions verified all five functions.
- Fixed unsupported admin recorded-activity panel and three section heading
  mismatches. Full web unit suite: 265 files, 5,108 tests passed.
- Supabase advisors were inspected. Other pre-existing warnings (mutable function
  search paths, security-definer callable helpers, extension placement and leaked
  password protection) are not all resolved by the invitation grant repair.

All 13 role login/logout browser checks pass, including the client. QA-only
writes creating a department/team and a quality case/run also pass, as does
recording a developer result on that run. Notification
badge/read/reload regression passes after updating its mock from the retired
notifications table to notification_inbox and mark_notification_inbox_read.

**Storage blocker resolved:** the missing ledger and helpers are now installed.
All 289 original storage object records were compared before/after and remained
identical, including names, metadata, versions and timestamps. The 288 unassigned
legacy objects (43,749,177 bytes) remain in their private buckets with a separate
private inventory. Their tenant is not guessed; mutation/deletion is blocked until
an operator resolves ownership. Current tenant-attributed usage is accounted
separately. New unmapped uploads remain rejected and shared quotas remain enforced.

The isolated SQL fixture proves preservation, inaccessible inventory, immutable
legacy files, combined workspace quotas and final-size validation. A real QA-only
Storage API upload/download test confirmed exact usage increases and cleanup back
to the starting total. Supabase's temporary upload-permission probe needed a second
compatibility migration; finalized uploads still require authoritative size.
No original file was modified, moved or deleted. The temporary PAT was used only
for this project's direct Management API requests and its temporary file was removed
after database verification; no connector/CLI login was made.

Post-storage-repair verification: the owner/admin full console walks and billing
screen passed, as did the live storage API round trip and 20-object schema/RLS
readiness check. The owner's 35-route API batch exceeded the old 90-second test
budget under parallel load; with the batch budget raised to 180 seconds it passed
with no server errors. Per-action/permission assertions were not relaxed.
The fresh 126-test browser run finished with **104 passed, 3 failed, 19 skipped**.
Its three failures were the owner API batch timeout (passed on recheck), a designer
sidebar timeout, and a worker importing a stale helper after the test file changed
mid-run. Sidebar checks now wait for visible loading indicators instead of waiting
on persistent realtime network activity. A fresh seven-test role recheck passed
five, skipped one write, and exposed a real finance Clients permission mismatch.

The finance Clients page now checks `member.invite` before loading/rendering
invitations and `member.provision` before offering account creation. The existing
client roster remains visible; server authorization was not relaxed. The regression
also checks that administrators retain their invitation controls. After this change,
the production build and all **5,108 unit tests across 265 files** pass. The first
sandboxed unit attempt could not spawn the document generator (`EPERM`); the full
suite passed with subprocess access. Final browser recheck: **6 passed, 1 skipped**
in 4.7 minutes. Team lead, finance, QA, admin, designer and devops each passed their
complete offered-sidebar walk. Finance's client roster rendered without forbidden
invitation/provisioning controls; admin retained invitation controls. The skipped
quality write was already exercised successfully in the earlier authorized QA-only
write run. All three failures from the 126-test run now have passing targeted
rechecks; that broad run itself is still recorded with its original counts.

Database repairs were applied to the requested Supabase project. Application code
fixes were built and browser-tested locally on port 3100; a hosted application
redeployment was not performed. Historical file ownership still requires verified
records before those files can be attributed to a tenant. External payment/delivery
and native device acceptance remain outside the verified results.

The following broad run was the earlier, pre-storage-repair run.

The broad browser run completed: **92 passed, 13 failed, 20 skipped (125 total)**.
It ran while missing dependencies were being repaired; it is not a clean final
pass. Subsequent targeted rechecks passed notification behavior, all report tabs,
and owner invoicing/permission matrix. The 13 role sessions all passed within
that run, and all 12 permission matrix roles passed across the run plus the
owner recheck. Those earlier billing failures shared the then-unresolved storage ledger.
The QA sidebar timeout was increased to the same 300-second budget as the other
multi-screen surveys; the QA sidebar recheck passed. Seed creation, outbound messaging
and some unprepared lifecycle cases remain skipped; they are not passing tests.

Restored the synthetic QA client's missing link to its existing QA Client Project
A through the owner UI. The idempotent repair check passed. Final client/QA rerun: 8 passed,
1 support-send test skipped; project tabs and conversation access passed. **Full workflow acceptance is not
claimed.** Initial baseline evidence follows.

## Initial baseline

### Environment and verified results

- Current working tree, including pre-existing uncommitted changes.
- Fresh Next.js production build, served locally on port 3100 using the
  existing `.env.local` backend and `.env.e2e` QA accounts.
- Build: passed, with 29 existing lint warnings.
- Web unit tests: 5,107 verified passing across 265 files. Initial run had
  5,106 passes and one sandbox `spawnSync node EPERM`; rerunning the affected
  54-test file outside the sandbox passed all 54.
- Desktop tracker: 225 passed, one skipped out of 226 using the existing
  `/tmp/desktop-final-venv`. The skip requires the Windows message loop.
  The system Python initially lacked dependencies; that attempt is not counted
  as an application failure.
- Live anonymous API audit: all 134 protected handlers returned 401.
- Live middleware bypass-header check: all three protected areas redirected
  to login.
- Live Android bootstrap: public configuration contains only the expected
  fields and an anon/publishable key. Its intentionally public endpoint was
  missing from the old security test allowlist; that test is corrected.
- Mocked platform-owner browser checks: light/dark UI, organization details,
  deletion confirmation, denied access and mobile overflow passed. **No real
  organization was deleted.**
- Mocked organization browser checks: account switching, setup, verification
  flow, error preservation, and 1440/768/390-pixel layouts passed.

### Every role: live identity preflight

All 12 role passwords, plus the second organization's owner password, were
accepted by Supabase Auth. That alone does not make a valid application session.
Every original claimed workspace returned 401 from `/api/me/permissions`.

| Role | Authentication | Original fixture problem |
| --- | --- | --- |
| Owner | Passed | Claimed admin profile missing; one different accessible workspace exists |
| Admin | Passed | Claimed admin profile missing; no accessible workspace |
| Manager | Passed | Existing staff profile has null `auth_user_id` |
| Team lead | Passed | Existing staff profile has null `auth_user_id` |
| HR | Passed | Existing staff profile has null `auth_user_id` |
| Finance | Passed | Existing staff profile has null `auth_user_id` |
| QA | Passed | Existing staff profile has null `auth_user_id` |
| Developer | Passed | Existing staff profile has null `auth_user_id` |
| Designer | Passed | Existing staff profile has null `auth_user_id` |
| DevOps | Passed | Existing staff profile has null `auth_user_id` |
| Employee | Passed | Existing staff profile has null `auth_user_id` |
| Client | Passed | Claimed client profile missing; no accessible workspace |
| Organization B owner | Passed | Claimed admin profile missing; one different accessible workspace exists |

The corresponding old memberships and organizations still exist and are
active. The nine staff profile emails and organization IDs match their QA
claims, but their identity links are absent. Existing membership rows do not
replace those links. At this initial baseline, no profile links, memberships, claims or roles had been changed.

The initial 109-test browser suite was interrupted after confirming a shared
fixture blocker: 2 failed, 2 interrupted, 105 not run. Both completed failures
waited for the old owner's workspace ID, which the chooser no longer offers.
These are not 109 passing tests, nor 109 independent product defects.

### Database availability findings

After explicitly selecting an available owner workspace, application
permissions returned 200 and the console opened. Its Shift Schedule showed
“The schedule is temporarily unavailable” and attendance exceptions also
showed an unavailable state. Billing logged “Account billing lookup unavailable”.

Read-only schema checks confirmed:

| Resource | Observed response |
| --- | --- |
| `public.work_shifts` | 404 / PGRST205: absent from API schema cache |
| `public.shift_attendance_reviews` | 404 / PGRST205: absent from API schema cache |
| `public.billing_scope(p_org)` | 404 / PGRST202: absent from API schema cache |

Relevant migration sources are
`20260914074151_production_work_shift_scheduling.sql`,
`20260914174305_production_shift_attendance_exceptions.sql`, and
`20260920070343_shared_account_billing.sql`. These observations establish API
unavailability, not the complete migration history. Verify actual deployment,
dependencies and schema exposure before applying anything. No migrations were
applied during this QA run.

### Owner console survey

Both QA owners successfully selected their currently accessible workspaces,
opened the console, and received a 200 permissions response. These workspaces
each contained one member and zero projects, so they cannot stand in for the
old multi-role/project/isolation fixtures.

All 41 offered sections were visited for owner A. Four failed the UI checks:

| Section | Observation |
| --- | --- |
| My Activity | “Could not load your recorded activity” error state |
| Reports | Expected level-one screen heading did not appear |
| Automation | Expected level-one screen heading did not appear |
| Billing | “Billing information is temporarily unavailable” error state |

During this survey the browser recorded 503 responses from
`/api/automation/process`, `/api/billing/feature` (twice), `/api/invoicing`,
and `/api/billing/subscription`. Reports and Automation need a repeat after
the billing dependency is restored before attributing their missing screen
headings to a separate rendering defect.

The other 37 sections passed the limited heading/error-state assertions.
**This is not acceptance of their complete workflows:** the Invoicing API
still returned 503, and the earlier Shift Schedule run exposed unavailable
data even though the later survey's UI assertion did not catch it. The owner
survey as a whole failed. Empty lists, deferred requests and billing gates
require function-specific tests after the backend and QA seed are repaired.

### Remaining acceptance work

1. Restore or replace the dedicated QA seed with verified Auth/profile links,
   current workspace IDs, and two organizations containing the required projects.
   A missing profile must not be guessed or recreated from an email alone.
2. Reconcile the connected database with the current application's migrations
   and verify the unavailable tables/functions through the normal APIs.
3. Rerun the role, permission-matrix and tenant-isolation suite. Then exercise
   the write workflows on valid QA data: project/task assignment, plan submission,
   review/approval, timer/completion, leave/timesheet approvals, quality results,
   onboarding/offboarding and client decisions.
4. Test real billing-provider transactions and external-message delivery in
   their dedicated test environments; neither was performed here.
5. Verify native Windows capture/lifecycle and Android behavior on devices.
   Python and mocked browser tests do not establish hardware behavior.

### Evidence and changed tests

Local private browser reports are under `artifacts/qa-20260921/`; this path is
git-ignored because authenticated traces can include session material.

- `browser-report/index.html`: interrupted original role suite.
- `security-final-report/index.html`: three passing live security checks.
- `workspace-report/index.html`: actual chooser checks, including the passing
  organization B owner selection and initial owner module failure.
- `workspace-survey-report/index.html`: broader owner section survey.
- `scripts/qa-role-preflight.cjs`: read-only, credential-redacted identity diagnostics.
- `e2e/workspace-selection.spec.js`: explicit chooser coverage that does not
  silently substitute a different workspace for the old project fixture.
- `e2e/audit-security.spec.js`: public mobile-bootstrap classification and
  public-key-only assertion.
