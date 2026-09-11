# Production readiness implementation — 11 September 2026

Status: implementation and local regression completed for the changes below; **not a production certification**. The new migrations have not been applied to the connected Supabase project. This update supersedes the enforcement and desktop rollout limitations in the earlier [audit](audit-2026-09-11.md); that file remains a historical record of its observations.

## Implemented and verified locally

| Area | Root cause and correction | Verification |
| --- | --- | --- |
| Resource quotas | UI/API seat checks could race or be bypassed with direct writes. Database triggers now count staff, developers, projects, open tasks and screenshots under a per-organization physical row lock. Non-increasing updates remain possible above a downgraded limit. | Real PostgreSQL inserts/updates, final-slot concurrent transactions at READ COMMITTED and REPEATABLE READ, expiration/cancellation/unpaid/demo states. |
| Plan features | Reports loaded directly in the browser; client and automation entry points did not consistently enforce plans. Added authenticated report/feature APIs, frontend boundaries, restrictive client/automation database policies, and plan checks on client proposal/change-request service APIs. | Unit permission/refusal tests, SQL feature and cancelled-plan cases. |
| Storage/history | No shared byte ledger; direct desktop writes and known old object paths could bypass limits. Added exact-byte accounting for six application buckets, upload/finalization/upsert quota checks, and history RLS on tracking rows and screenshot objects. | Synthetic Storage metadata regressions, unknown mapping/invalid size refusals, legacy backfill, replacement/delete accounting, and old-path read denial. Real Supabase Storage API compatibility remains a deployment gate. |
| Device authentication | A fleet secret did not bind a device to its own identity. Added JWT-session enrollment/revocation/expiry, monitoring write RLS, device-bound production HTTP ingest, Account device controls, and desktop enrollment at login. | SQL impersonation, enrollment and revocation tests; API tests; six offline Python login/logout tests. |
| Invitation transactions | Independent profile, membership, Auth and Terms writes could leave partial accounts or delete an account after an ambiguous commit. Reserve identities before Auth creation; commit all application rows, Terms and acceptance in one RPC transaction; reuse identities on retry; lease expired/revoked orphan recovery in cron. | Actual SQL role/profile/company/project/Terms mapping and rollback, claim/recovery exclusion, API failure tests and recovery identity tests. |
| Checkout reliability | Stripe lookup errors could be confused with absence; webhook lag and repeated checkout could create another subscription. Verify customer subscriptions, reuse open sessions, expire replaced sessions, use stable idempotency keys, refuse pending/conflicting states, and report failed synchronization. | Fifteen mocked Stripe/API tests, including card errors, webhook delay and repeated requests. No actual payment was made. |
| Permission overrides | Organization UPDATE admitted admins despite owner-only catalogue defaults. Employee row-level rules coupled unrelated actions and allowed field bypasses. Added field-specific activation, transfer, hierarchy and weekly-hours checks, identity immutability and owner-default organization settings. | Actual SQL grant/deny combinations and forbidden direct updates. This is targeted coverage, not proof that every historical policy honors every catalogue override. |
| Client privacy | Direct change-request SELECT could expose internal PM notes that the API removed. Restricted clients to the filtered API. Review screenshot reads/signing now use the caller JWT and history/monitoring RLS. | SQL direct-client note denial and existing state-machine regressions. |
| Error handling | Employee/report lookups could display an empty directory or zero tracked activity after a query failure. Fail visibly with retry errors; billing counter failures fail closed. | Unit tests and production build. |

Plans remain **Free, Professional, Business, Enterprise**. No Basic plan was introduced. Existing catalogue values remain authoritative; no request limit or public API product was invented. `api_access` is false in the inspected catalogue. History means an **access window**, not scheduled destructive deletion.

## Regression evidence

- Web: 99 Vitest files / 3,136 tests passed after the final API changes. Some tests are static invariants, not independent end-to-end journeys.
- Production Next.js build passed. Existing hook/image lint warnings remain; no disabled lint rules were introduced.
- `bash scripts/test-audit-policies.sh`: actual isolated PostgreSQL policy/quota/storage/device/invitation/permission regressions, including overlapping transactions. Test fixtures are minimal synthetic schemas and do not substitute for inspecting the deployed schema.
- Desktop: `python3 -m unittest discover -s tests -p 'test_device_login.py'`: six tests passed. This is a separate repository at `developer-tracker`.
- Browser regression: see the appended result below. Business-data write tests and seeding are disabled against shared QA data. Notification display tests intercept their notification fixture; they do not prove realtime delivery for every event writer.

## Deployment order and gates

1. Obtain staging SQL access, inspect actual policies/grants/triggers and backup/recovery procedures. The connected SQL tool currently denies permission; no live schema definition inspection or new migration application was possible.
2. Preserve the historical migrations through 096 and the two audit migrations already supplied. Apply the nine new timestamped migrations in ascending order: `20260911055537`, `20260911060849`, `20260911062113`, `20260911062805`, `20260911063616`, `20260911065148`, `20260911071332`, `20260911072728`, `20260911074242`. **Never run `database/tests/*` in Supabase.** They create synthetic schemas and roles.
3. Storage backfill deliberately aborts if an existing application object cannot be assigned unambiguously to its organization. Resolve historical object ownership before applying it. Do not delete metadata directly; use the Storage API for object cleanup. The private usage ledger requires object cleanup before deleting an organization with stored files.
4. Validate upload/finalization/upsert/delete/signing against the actual staging Supabase Storage service. The accounting trigger extends a managed schema; its synthetic PostgreSQL tests do not establish compatibility with every Storage release.
5. Deploy the updated desktop application together with device migrations before enabling the new web ingest handlers for existing devices. Users must log in again to enroll. Production fleet secrets no longer authorize these handlers.
6. Configure Stripe test secret, webhook signing secret, actual plan price IDs, public app origin and Customer Portal. Exercise paid/failed/3DS checkout, invoice/webhook retries and order, cancellation, renewal, upgrade/downgrade and older duplicate subscriptions in test mode. Mocked tests cannot establish payment-provider behavior.
7. Configure/verify cron and invite email delivery. Exercise actual Auth reserved-ID creation, interrupted acceptance, retry and expired-account cleanup on staging.
8. Run write-enabled role/workflow regression only against an isolated staging dataset. The live Vercel URL previously challenged automated authenticated requests; arrange an authorized staging test path without disabling production protections.

## Remaining work and verification limits

- Full deployed RLS/view/function/grant and per-field override parity across all historical modules is not yet certified. The new SQL targets confirmed gaps; it is not a blanket rewrite of all policies.
- Every notification event writer, recipient authorization, realtime reconnection and linked destination still needs full staging workflow coverage. Recipient isolation was addressed in the earlier audit.
- Proposal acceptance, HR multi-record changes, organization deletion/storage cleanup and other multi-step workflows still require transaction/failure-recovery review beyond the invitation transaction completed here.
- Signed URLs already issued remain usable until expiry. History access enforcement is not an automatic retention/deletion service. OS-level tracking, screen permissions, real screenshots, uploads, refresh-token behavior and device expiry while running require actual supported desktop devices.
- The earlier live aggregate found one legacy admin password copy. Its Auth linkage could not be verified, so it was not blindly deleted. Account recovery, credential rotation and deletion of the legacy copy remain pending. Revoke the GitHub token previously posted in chat; do not commit it or paste another token into chat.
- Legal entity, jurisdiction, adoption dates, contractual promises and other owner-supplied legal placeholders cannot be invented. Product enforcement descriptions were updated, but those owner decisions remain outstanding.
- Dependency vulnerability scanning was not completed: automatic approval review rejected sending dependency metadata to the npm registry. Do not interpret a successful build as a clean vulnerability scan.

References used for the implementation: [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html), [Supabase Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design), [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [Checkout session expiration](https://docs.stripe.com/api/checkout/sessions/expire).

## Browser and repository handoff

The selected post-change browser run exercised 24 checks: **21 passed, 2 failed, 1 skipped**. All twelve roles passed the API allow/deny matrix. Anonymous API/middleware checks, permission override loading/reload, notification fixture state, team-lead/QA console navigation and designer/devops staff navigation passed. Admin and Finance navigation reached Billing, where the connected database could not provide the new storage-usage RPC. The API correctly returned 503; the billing heading was preserved in the error state and retested. Billing functionality remains blocked until migration and integration verification; the tests were not weakened to accept the missing backend.

Web implementation is committed on `fix/production-readiness-guards`; the separate desktop implementation is committed on `fix/device-session-enrollment` (`4a17ffc`). Prior audit PR #98 is merged. Pushing the new web branch failed with GitHub's “Invalid username or token”; no new remote PR was created. Reconnect repository write access before publishing these commits for review. Neither branch should be merged/deployed before the migration and desktop compatibility gates above are satisfied.


## Project staffing follow-up

The historical `project_members_write` policy admitted any organization manager, bypassing the API's requirement that managers belong to the project. Migration `20260911071332_production_project_staffing_permissions.sql` now applies project scope and explicit overrides to direct staffing writes. Allocation-only grants cannot change project roles; allocation denies do not prevent otherwise permitted staffing changes. New team entries require an active staff membership in the same organization and project. Membership identities cannot be reassigned by updating their UUID fields. Removing or demoting a manager requires the existing manager-reassignment flow.

The project team API now checks locked subscriptions before privileged writes and checks `capacity.allocate` when allocation is explicitly submitted. Omitting allocation no longer resets a saved value to null. It also rejects manager demotion through team upsert. Seven new API tests cover these cases; actual PostgreSQL tests cover project scope, override combinations, identity changes, missing target membership and manager removal/demotion.

Follow-up web regression: **100 files / 3,143 tests passed**, and the production build passed. This does not replace the previously recorded staging billing failures or establish full policy parity for other tables. GitHub write access and staging SQL verification remain required.


## Profile-type identity follow-up

Membership uniqueness is `(organization_id, user_id, user_type)`. Historical SQL override lookup and project-role lookup omitted `user_type`, so an Admin-table and Developer-table identity sharing the same UUID could inherit each other's exceptions or scoped project role. The server project-role loader and migration `20260911072728_production_typed_permission_identity.sql` now include the verified profile type. Missing/unsupported types fail closed; suspended memberships cannot provide overrides. SQL tests deliberately create colliding UUIDs across profile types and verify both isolation and preservation of the matching identity's access.

The concurrent quota test was also corrected: its old two-second sleep could finish before the second Docker process established its snapshot. It now waits for the first transaction to be idle in transaction and the second to be observably blocked on a database lock before releasing the first. This avoids treating sequential execution as a concurrency test. The full SQL regression passed with the explicit barrier and typed-identity cases.

Typed-identity follow-up validation: **100 web test files / 3,146 tests passed**, production build passed, and all isolated PostgreSQL regressions passed. Supabase SQL access was rechecked with a read-only policy query and still returned “You do not have permission to perform this action.” There are now eight pending migrations; production verification remains incomplete.


## Invitation authority and delivery follow-up

Historical generic organization policies allowed staff to read and write invitation rows. Because the token accepts an invitation and establishes a password, exposing higher-role tokens is an account-creation authority leak, not merely directory visibility. Migration `20260911074242_production_invitation_authority.sql` restricts tokens to callers with `member.invite` whose role strictly outranks the invitation role. The service-role list API applies the same rank filter. Ordinary staff cannot harvest tokens; HR cannot read Admin/Manager invitation tokens. Explicit denies also apply. Direct edits cannot change an invitation's role, token, email, scope, or acceptance state; direct management permits revocation, and deletion cannot erase pending Auth-recovery identity records.

Pending invitation writes now normalize/validate email, verify linked organization resources and subscription access, and serialize duplicate checks using the existing physical organization lock. An expired pending invitation does not prevent creating a new invitation. Existing duplicates are not silently revoked or deleted. The UI excludes expired invitations from its duplicate warning and reports “Invitation created” when delivery fails instead of claiming it was sent.

Invitation email URLs now use configured `NEXT_PUBLIC_APP_URL`; production requires a valid HTTPS origin before inserting an invitation. Caller-supplied Origin/Host headers cannot choose the destination receiving the token. Development may use the request URL. Delivery failure retains the invitation and its manual share-link fallback. No email was sent during the offline tests.

This is a high-priority production verification item: the policy fix is prepared locally and has **not** been applied to the connected project. Source inspection proves the historical gap; current deployed policy definitions remain inaccessible through the SQL connector.

Invitation follow-up validation: **101 web test files / 3,159 tests passed**, production build passed, and the complete isolated SQL regression passed. Read-only live HEAD requests selected/count-checked the token column without fetching token values: Owner, HR and Developer each saw zero pending Admin/Manager invitations in the QA organization. Owner's zero means there was no positive fixture, so this does not establish either live exposure or live isolation. No invitations or other business records were created by the probe. Nine migrations now await staging verification.

## Client notification privacy follow-up

The client email endpoint used a service client without checking active membership, ignored recipient-query errors, and permitted invoice messages to fan out to project clients or the whole organization. This contradicted the invoice read policy, which exposes invoices only to their named client. Invoice notifications now require a client ID and target only that client. A project association does not require that invoice's named client to be a project member, preserving the existing invoice ownership rule. Other project notifications require project linkage, including when both IDs are supplied.

Recipient queries now require active client profiles and active client-type memberships in the same organization. Missing projects return 404, mismatched project/client recipients return 403, and failed recipient lookups return a generic 503 without sending mail. The endpoint enforces the existing `client_portal` entitlement before lookup, validates message fields and IDs, preserves BCC privacy, and reports actual provider delivery rather than attempted delivery.

Validation: **102 web test files / 3,188 tests passed**, including 29 new API regression cases. The final production build passed with the existing lint warnings. All email operations were mocked; no real notifications were sent. This closes this endpoint's confirmed issues, not the remaining automation and direct notification-writer audit. Nine previously documented migrations remain unapplied to the connected project.

## Automation recipient and delivery follow-up

Automation fan-out previously selected memberships regardless of activation status or profile type, allowing internal task emails to reach clients and suspended members. Recipient selection now requires active Admin/Developer profiles, with matching SQL filters and defensive row checks. Admin profiles use the notification's admin recipient field. Fallback profile email queries are organization-scoped and keyed by profile type plus ID; lookup failures are reported without exposing database details. Duplicate addresses are emailed once.

Malformed notification fields and oversized recipient lists now fail validation rather than being silently truncated/coerced. A task reference must resolve in the caller's organization before notifications are inserted; missing tasks return 404 and lookup failures return 503. The notified count now uses returned insert rows, so preferences that suppress an insert do not inflate the result. Existing automation permission and plan gates remain in place.

This does not establish complete task-level notification privacy: per-recipient task permission/override checks, typed identity in the database recipient predicate, and all direct notification writers still require audit. No real emails or business records were created during these tests.

Automation follow-up validation: **102 test files / 3,200 tests passed** and the production build passed with existing lint warnings. Eleven new behavior cases cover recipient status/type, malformed requests, missing tasks, recipient identity fields, fallback lookup errors, and suppressed-insert counts. The static role-array test now documents the recipient profile-type filter separately from caller authorization.

## Task notification permission follow-up

Automation messages with a task reference now validate the sender and each recipient against the existing task reader/reviewer permissions. `task.view_all` or `task.review` permits reading others' work; receiving one's own work requires `task.view_own` and a matching Developer-profile assignment. An Admin-profile UUID cannot impersonate a Developer assignment. Each recipient's overrides are loaded with their organization, profile type, and profile ID; lookup failure aborts before notification insertion or email. Explicit denies and grants follow the shared permission engine. Requests with no eligible recipients return 403.

These checks apply to task-referenced automation notifications. They do not certify the generic direct database notification writers, the historical task-table policies, or the recipient predicate's legacy identity fields. Free-text organization automation messages remain available to active staff recipients under the existing automation permission and subscription gate.

Task notification validation: **103 test files / 3,219 tests passed**, and the production build passed with existing lint warnings. Nineteen new tests cover role access, own assignment, typed UUID collisions, grants/denies, organization isolation, unavailable overrides, and API fan-out prevention. Tests used mocked database/email operations; staging verification and the nine pending migrations remain outstanding.

## Notification update integrity follow-up

Migration `20260911081955_production_notification_update_guard.sql` removes the historical Owner/Admin exemption from the notification UPDATE trigger. Previously, a recipient with either role could retain their own addressing field while adding a second recipient or rewriting content, satisfying both old and new recipient RLS checks. All ordinary authenticated sessions now may change only `read` and `read_at`. Comparing complete row JSON with those two fields excluded also protects new columns that the historical enumerated guard did not cover. Trusted database/service roles retain maintenance access; an application role or JWT claim cannot grant that exemption.

The complete isolated PostgreSQL suite passed, including new Owner/Admin content edits, second-recipient injection, unenumerated metadata changes, normal read/unread state, Developer restrictions, and trusted database maintenance. No JavaScript changed; the last web regression remains 103 files / 3,219 tests with a passing production build. This adds a tenth pending migration. It has not been applied to the connected project, and direct notification INSERT authorization and legacy recipient identity collisions remain separate audit items.

## Delivery subscription write-lock follow-up

The resource quota trigger intentionally returns early for updates that do not increase usage and for tasks outside the active status set. That left direct project/task edits, deletes, and completed-task inserts outside the subscription write lock, even though submission/review APIs already call `requireUnlocked`.

Migration `20260911083056_production_delivery_write_lock.sql` enforces the existing subscription lock for every project/task mutation, including service-role writes. It uses the same organization lock as quota/subscription changes, checks both organizations during transfers in a stable lock order, and preserves cascading organization deletion without recreating a removed organization's quota-lock foreign key. Resource limits remain separate: cancellation/downgrade to Free preserves neutral edits rather than treating an over-limit workspace as write-locked.

The full isolated PostgreSQL regression suite passed. New cases verify expired trials, expired payment grace, unpaid subscriptions, completed-task insertion, neutral updates, deletion, trusted backend writes, preserved reads, cancellation to Free, and locked-organization cascading cleanup. Existing concurrent quota tests also passed with the new trigger. No JavaScript changed; the previous 3,219-test web run and production build remain the latest web verification. Eleven migrations now await staging verification. Per-role task-table authorization and the rest of the table/field permission audit remain incomplete.

## Task review integrity follow-up

`pmData.changeTaskStatus` deliberately routes completed/rejected outcomes through the review API, which checks reviewer permissions, submission state and separation of duties and records scoring. The historical task-table policy nevertheless allowed direct updates to those outcomes and scoring fields. Migration `20260911083449_production_task_review_integrity.sql` blocks direct terminal verdicts, direct reopening of completed tasks, forged review/submission timestamps, comments/verdict attribution, and productivity score changes for ordinary authenticated sessions regardless of application role. Fresh tasks cannot contain a verdict; the existing zero-score default remains valid. Trusted server review/submission operations retain write access.

The complete isolated SQL suite passed. The fixture explicitly recreates the historical broad task policy and asserts row visibility before testing denial, preventing a zero-row update from masquerading as field protection. Cases exercise Owner, Admin, Manager, Team Lead, QA, Developer, HR and Finance, normal starts, fresh pending tasks, trusted review writes and completed-task reopening. No JavaScript changed. Twelve migrations now await staging verification. Broader task assignment/read/edit permissions, transactional task-plan replacement and atomic multi-record review remain separate unfinished work.

## Atomic task-plan save and submission

The developer project page previously deleted replacement candidates, inserted new tasks, and marked the project submitted in separate requests. An insert failure could remove the old draft, and a later submit failure left partially applied state. The page now calls `/api/task-plan/save-submit`, which derives the organization and Developer identity from verified authentication, enforces `task.update_own` and the subscription lock, and calls one service-only database transaction.

Migration `20260911083905_production_task_plan_transaction.sql` verifies active typed membership, explicit permission denial, assignment and project state; serializes with the organization quota lock and project row lock; replaces eligible drafts; and marks submission in the same transaction. Failed quota checks roll back the deletion. Pending-plan retries return the existing saved result without duplicating tasks, and approved plans cannot be replaced. Started tasks and drafts with linked records survive. A private FK-based helper protects submissions, comments, time logs, attachments and other linked records; task row locks prevent a child insert racing the reference check and delete. The browser stores returned task UUIDs in its cache. Ambiguous transport errors invite retry rather than claiming the transaction did or did not commit.

The legacy submit-only API remains available for compatibility. This does not make the separate review API's multi-record updates atomic or complete the broader task authorization audit. The new RPC must be deployed before this UI/API change. Thirteen migrations now await staging verification; the connected project has not received them.

Web validation: **104 test files / 3,232 tests passed**, production build passed with existing lint warnings. API tests exercise verified identity, profile-type collision prevention, permission/billing refusal, malformed requests and database error mapping. SQL tests cover quota rollback, work/reference preservation, repeat submission, assignment, service-only execution, invalid dates and permission denial. These are isolated tests, not a completed live browser journey against the pending RPC.

Final task-plan SQL verification: the complete isolated PostgreSQL regression suite passed with the new transaction and linked-record checks installed.
