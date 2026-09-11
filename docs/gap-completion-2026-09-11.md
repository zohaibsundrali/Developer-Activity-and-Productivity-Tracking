# Confirmed-gap implementation — 11 September 2026

This batch follows migration-recovery PR #100. It does not certify the deployed application or replace recovery of the failed storage accounting migration.

## Completed in code

- Sprint status and typed, preference-aware task-linked notices commit together. No-op retries do not duplicate delivery; reopening and starting again is a new event. Browser-forged sprint events are refused.
- Project/team/employee notification reads check current typed membership and effective entity access. Revocation and team removal hide previously delivered content, including trusted deliveries; task/proof notifications retain their independent task access rules.
- Proposal decisions, project creation, client linkage, manager notices and client email jobs share a transaction. Concurrent decisions serialize; acceptance retries reuse the existing project. Direct client reads cannot expose internal notes, and client inserts cannot forge staff estimates.
- Proposal client emails use a leased durable queue and cron retry, verify the current active typed client membership, and do not acknowledge mock delivery as real. SMTP delivery remains at least once if provider acceptance succeeds but its database acknowledgement is lost.
- Employee membership/profile saves are atomic invoker RPCs that preserve RLS and per-field guards. Team/status notices use actual transitions. Auth role changes remain a separate service boundary and report partial outcomes explicitly. Ambiguous legacy team leaders are not guessed.
- Task automations capture actual events in durable jobs. Authenticated server processing executes task changes using the original actor's current JWT/RLS, validates current plan/rule/task/recipient access, records progress, retries failures, and deduplicates notices. Dashboard mount/reconnect/visible-session retry resumes queued work. Admin automation settings and Developer Account expose the actor's own history and retry with loading/error states and stale-session protection. External email outcomes that cannot be confirmed remain visible for manual verification.
- Project assignment, nonterminal task status and milestone completion now create notices in the same database transaction as the actual state change. Failed notification delivery rolls back the change; browser writers and forged events are removed.
- Browser inserts cannot forge four additional server-only events: proposal submission, client approval, client changes requested, and project manager assignment.
- Milestone writes require the same effective planning permission as sprints/epics, including active typed membership, billing and project scope. UI controls use that permission; zero-row writes are reported as failures and immutable identities cannot be moved.
- Dependency advisory scanning now works. Compatible lockfile fixes, Nodemailer 9.1.1, the Next 15 PostCSS 8.5.23 override, and Vitest 4.1.11 remove the reported findings without upgrading the Next.js major version. Runtime/build compatibility is regression-tested; an advisory scan is not proof that no undiscovered vulnerabilities exist.

## Validation

- Web regression: 157 files / 3,675 tests passed on Vitest 4.1.11. The existing permission-document generator needs subprocess access; its initial sandbox EPERM was resolved by running with that access. A stale browser-notification expectation was updated to require no duplicate browser delivery after the database conversion.
- Next.js production build passed. Existing lint warnings remain; this is not a warning-free codebase.
- Complete `scripts/test-audit-policies.sh` PostgreSQL policy/concurrency regression passed, including all eight new migration fixtures and three competing proposal-decision scenarios. Focused tests passed for each new migration, including rollback on notification failure, permission overrides, typed identity collisions, scoped writes and replay behavior. Automation mutation and notification triggers were also executed together.
- Dependency audit reports zero currently known advisories after installation; the patched Nodemailer SMTP-shaped composition was tested offline without sending email.
- SQL bundle is generated from the exact reviewed source migrations and checked with `python3 scripts/build-confirmed-gap-sql.py --check`.

## SQL deployment

Apply PR #100 recovery only if its five original migrations are still failed; never replay successful migrations. `scripts/sql/production-recovery-verification.sql` is a read-only existence/enabled-state check, not a migration-history repair or a verification of function bodies.

After recovery prerequisites exist, apply these NEW migrations once in this order:

1. `20260911163008_production_atomic_sprint_notifications.sql`
2. `20260911163106_production_notification_entity_privacy.sql`
3. `20260911163247_production_durable_actor_automation_jobs.sql`
4. `20260911163440_production_atomic_proposal_decisions.sql`
5. `20260911163620_production_atomic_employee_save.sql`
6. `20260911164338_production_server_notification_event_guard.sql`
7. `20260911170307_production_atomic_work_transition_notices.sql`
8. `20260911171109_production_milestone_write_authority.sql`

SQL Editor users may run the complete `scripts/sql/confirmed-gap-recovery.sql` instead of those individual files. It is the same new SQL in one transaction. Use ONE method; do not run both. Do not run database/tests in production. Manual SQL Editor execution does not reconcile CLI migration history.

Validate on isolated staging data first. Apply SQL and deploy the matching application in one maintenance window with writes paused; reload existing browser tabs before resuming work. Older tabs still contain the previous browser automation executor, so allowing both versions to process work during rollout can duplicate actions. Configure the existing cron secret/schedule and real email provider, then verify live role journeys.

## Still requires action or verification

- Unknown legacy `documents/tjrpeg2z0p_1763539495923.pdf`: no uploader, screenshot, organization-path or checked application-table reference was found. Ownership/content must be verified by the operator before supported Storage API mapping/migration or an explicitly authorized cleanup. No file was deleted or arbitrarily assigned; storage accounting remains blocked.
- Confirm the actual production recovery/migrations succeeded and verify hosted Storage upload/finalization/sign/delete behavior. Local PostgreSQL fixtures do not implement the hosted Storage service.
- Truly unattended automation execution while the actor never returns is not provided by the actor-JWT recovery model. Do not replace it with unrestricted service-role task updates. Service actions without a verified actor are not newly assigned an invented automation identity.
- Generic user-authored messages remain user content. The specific authoritative workflow event types converted in this batch cannot be forged by browser inserts.
- Organization deletion and cross-service cleanup are not a completed recovery workflow. Deleting a project tied to an accepted proposal remains blocked by the existing accepted-project relationship guard; proposal provenance is not silently deleted.
- Automatic destructive retention is not enabled: the existing plan history contract is an access window. Deletion policy and multi-day fractional-leave allocation still require explicit product decisions.
- Real Stripe/3DS/webhooks/renewal/upgrades/downgrades, invitation/email/cron delivery, desktop operating-system capture/expiry, and every-role production end-to-end verification remain external deployment checks.
- The previously reported legacy password-copy issue is resolved in the inspected production data: read-only service-role aggregate checks returned zero non-null password values in admin_users, developers and clients. No credentials were fetched or changed. Legal entity/jurisdiction/contract details still require owner-supplied facts.
- Full historical table/field permission parity across every module is not certified by this bounded set of fixes.

## Security update references

[Nodemailer releases](https://github.com/nodemailer/nodemailer/releases/tag/v9.1.1), [PostCSS security release](https://github.com/postcss/postcss/releases/tag/8.5.23), [Vitest migration guide](https://v4.vitest.dev/guide/migration.html).

## Read-only production evidence

PR #100 is merged. Authenticated service-role REST limit-zero checks confirmed the notification recipient/state/inbox schema and typed project ownership columns exist in the known project. The new automation_jobs table was absent, as expected before this batch is applied. These checks do not verify stored function bodies, triggers, grants, or complete migration history.

Local configuration inspection (presence flags only) found no Stripe secret/webhook secret, cron secret or public application origin in .env.local. SMTP credential fields exist, but validity and Vercel configuration were not checked; no real email or payment was sent.
