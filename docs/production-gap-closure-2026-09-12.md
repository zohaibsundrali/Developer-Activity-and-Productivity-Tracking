# Production identity recovery and verification

Existing missing identity records prevent a complete production role regression. Installing the account-provisioning code prevents the original partial-write behavior for new accounts; it does not reconstruct legacy profiles or relink existing users automatically.

## Operator order

1. Run `scripts/sql/production-migration-verification.sql` first. This is a read-only catalog comparison of the seven PR103/104 migrations. Share any missing/drifted checks. An existing table does not prove its migration completed. Do not replay a migration bundle or drop an existing table to bypass `already exists`.
2. For the eleven staff identities already reviewed, run `scripts/sql/identity-repair-preview.sql`. Confirm that these are intended active accounts and that each result is eligible with no failures. If the links were already applied, inspect current identity state instead of replaying the apply script.
3. Only for those verified, still-unlinked staff identities, run the whole `scripts/sql/identity-repair-apply.sql` statement once. It rechecks the exact same identifiers under locks. All eleven link changes and their audit inserts commit together or all roll back. Success returns `repaired_accounts: 11`, with an `auditId` per repair. This is a manual data repair, not a schema migration or scheduled task.
4. Run `scripts/sql/missing-profile-recovery-evidence.sql` for the five missing Admin profiles and one missing Client profile. One of those Admin memberships had no matching Auth candidate in the supplied diagnostic. Follow `docs/missing-profile-recovery.md`; original evidence must determine the next restoration step. Neither metadata nor an email match alone authorizes invented profile data.
5. Run `scripts/sql/current-identity-preflight.sql` after recovery, then sign out/in and test each role's allowed pages and denied direct API/database access. Repeat notifications and tenant isolation checks with working identities. A SQL result alone cannot prove successful role flows.

The operator must still identify whether the six missing profiles are real users or disposable QA identities and provide original onboarding/backup evidence where restoration is needed. No hosted Auth accounts, roles, profiles, or storage objects were changed by this follow-up.

## Remaining hosted verification

The existing read-only seeded QA probes still returned HTTP 401 from `/api/me/permissions` in this follow-up. Full live role regression remains blocked until the actual identity inconsistencies are reconciled. Local fixture success is not production proof.

Provider checks still need the deployed configuration and controlled test journeys: invitation/recovery email delivery, Stripe test checkout and webhook delivery, cancellation and plan transitions, scheduled worker execution, disposable organization Auth/Storage deletion, retention cleanup, and desktop capture/upload on supported operating systems. Use `scripts/check-worker-readiness.mjs` and `docs/production-worker-readiness.md` to check configuration names without printing secrets. Keep service secrets in the deployment's environment/secret manager, not in SQL output or chat.

The previously reported unowned PDF still needs an operator-proven organization mapping. This follow-up does not guess its owner or delete it.

## Validation scope

The scoped apply test runs actual migration functions in a disposable PostgreSQL 16 container with networking disabled. It verifies all eleven successful repairs, complete rollback when one candidate is suspended, and replay refusal without duplicate audits. No hosted database credentials are used by that test.

## Email reliability fixes in this follow-up

Resend sends, email-log database requests and password-recovery Auth requests have request deadlines. SMTP has bounded DNS, connection, greeting and socket inactivity waits. Timeout or aborted email outcomes are marked uncertain and are not immediately retried; password recovery also avoids immediately minting another link through its fallback. SMTP transport cleanup failures cannot replace a confirmed successful send.

These bounds do not impose a fixed total duration on every SMTP conversation or worker batch. Queued delivery retains its existing at-least-once semantics, so later retries can still duplicate an externally accepted message whose acknowledgment was lost.

No new schema migration is included in this follow-up. Existing missing/drifted PR103/104 objects must be reconciled from the verification output, rather than automatically replaying the seven migrations.

Final web regression: **188 files / 3,949 tests passed**. The production build passed with existing lint warnings. The first sandboxed suite attempt blocked the permission-document subprocess with EPERM; the complete rerun with subprocess execution allowed passed. No assertion was removed to obtain that result.

The missing-profile evidence tests passed read-only/privacy/classification and optional-column compatibility checks. The migration verifier passed absent-schema, partial-installation, all 61 expected checks, and injected function-security/grant/trigger/index drift cases. Its coverage limits are documented in `docs/production-migration-verification.md`.
