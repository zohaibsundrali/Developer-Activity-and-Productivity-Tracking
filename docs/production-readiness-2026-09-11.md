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
2. Preserve the historical migrations through 096 and the two audit migrations already supplied. Apply the seven new timestamped migrations in ascending order: `20260911055537`, `20260911060849`, `20260911062113`, `20260911062805`, `20260911063616`, `20260911065148`, `20260911071332`. **Never run `database/tests/*` in Supabase.** They create synthetic schemas and roles.
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
