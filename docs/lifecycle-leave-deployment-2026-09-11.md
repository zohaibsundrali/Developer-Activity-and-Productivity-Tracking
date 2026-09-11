# Lifecycle, retention and leave deployment — 11 September 2026

This is a separate five-migration batch after PR #101. It does not replace the earlier migration-recovery or confirmed-gap bundles, repair CLI migration history, or prove that the hosted application is deployed correctly.

## Apply the reviewed database changes

Confirm PR #101 and all earlier required migrations succeeded before proceeding. Do not replay earlier successful SQL. Take the normal database backup and deploy through the project's established release process.

Use either the five individual migrations below in order, or the complete generated [SQL Editor bundle](../scripts/sql/lifecycle-leave-deployment.sql), once as the database migration owner. Do not use both methods.

1. `20260911180306_production_unattended_actor_automation.sql`
2. `20260911180503_production_tracking_retention_jobs.sql`
3. `20260911180705_production_typed_leave_authority.sql`
4. `20260911180815_production_organization_deletion_lifecycle.sql`
5. `20260911182229_production_existing_leave_day_contract.sql`

The bundle wraps all five migrations in one transaction, with a 10-second lock timeout, prerequisite checks, and partial/repeated-install refusal. It includes each source filename and SHA-256. Generate and check it with:

```sh
python3 scripts/build-lifecycle-leave-sql.py
python3 scripts/build-lifecycle-leave-sql.py --check
```

A failed bundle rolls back. Investigate the reported error before retrying the entire file. If individual migrations already succeeded, apply only the genuinely missing migrations after reconciling the schema and migration history; do not bypass the bundle's replay guard. SQL Editor execution does not register Supabase CLI migration history automatically.

Hosted permissions for the restricted automation executor role and Storage policies must be verified with the actual migration owner. Do not weaken role attributes, bypass RLS, or directly delete managed `storage.objects` rows to work around a deployment error.

## Behavior preserved or completed

**Unattended automation:** the existing `/api/cron` schedule is daily at `06:00 UTC` (`0 6 * * *` in `vercel.json`). Eligible queued jobs progress without the actor logging in. Execution still checks the actor's current typed membership, effective permissions, task access and plan entitlement. Bounded batches can require subsequent scheduled runs; this is not a promise of immediate processing. Configure `CRON_SECRET` and verify that the hosted scheduler supplies the expected authorization header. Uncertain external email outcomes remain explicit reconciliation cases.

**Tracking retention:** installing the migration opts in no existing organization. The authorized owner chooses disabled, custom days, or plan-derived retention and confirms permanent deletion. Automatic file removal is limited to verified canonical objects in the private `monitoring` bucket. Legacy/ambiguous paths, business records, referenced records and open sessions are preserved. Storage bytes are removed through the Storage API; leased database jobs reconcile removal before deleting the screenshot record. Disabling retention does not restore deleted records or guarantee cancellation of an already running provider request.

**Leave:** the existing form counts inclusive calendar dates. Only a single date can be `0.5` or `1` day; a multi-date request must equal its complete calendar-day span. Weekends remain calendar days under this existing contract. No new workweek or holiday policy is introduced. API and direct database writes reject forged aggregate fractions. Invalid legacy requests retain unrelated editable fields, but cannot be approved until corrected; withdrawal and resubmission is available. Half-day approval preserves existing attendance and creates no false full-day `on_leave` row. Its `0.5` amount remains in leave records and existing capacity calculations. Own reads, overlaps, balances and attendance identities distinguish Admin and Developer profiles even when their UUIDs collide.

**Organization deletion:** starting deletion is irreversible. The owner must enter the organization name and acknowledge that starting freezes organization access; queued cleanup then cancels the subscription without proration or refund and permanently removes database/file/eligible-account data. A partial deletion cannot be restored. Save the private receipt link returned when the job starts. Continue pending cleanup or retry a failed step through the authenticated owner controls while available; the scheduled worker also progresses eligible jobs. The receipt remains read-only after the account is removed and cannot authorize retries. Shared accounts are retained when the lifecycle checks require it. An accepted proposal retains its verdict and the deleted project's name/date snapshot rather than showing a broken live-project reference.

## Hosted verification still required

Use a disposable staging organization and real configured third-party test services before enabling destructive production workflows:

- Verify the deployed API/UI matches this schema, role/Storage DDL succeeded, and direct Team Member requests cannot bypass the new rules.
- Verify an unattended queued task action progresses at the actual cron cadence without user login; verify revoked permissions and expired plan states prevent its action.
- Opt a test owner into retention, age test telemetry, and confirm Storage API removal, failed-provider retry, policy disable behavior, and preservation of unverified paths and referenced records.
- Request and approve a half day, a full calendar span including a weekend, and competing overlapping requests. Confirm attendance preservation, typed isolation and capacity totals.
- Start deletion only for an expendable organization. Save its receipt before continuing. Verify real Stripe cancellation, Storage removal, Auth cleanup/shared-account retention, retry after interruption, and receipt access after account removal. Confirm accepted proposal history after separately deleting its project.
- Verify configured Stripe, email, Supabase Auth/Storage and cron credentials in the deployed environment. Local fixtures do not prove hosted provider delivery or cancellation.

This guide and bundle perform no production execution. Hosted checks remain the deployer's responsibility; no hosted success is asserted here.

## Local verification

- Full Vitest regression: 168 files, 3,760 tests passed.
- Final affected authorization and receipt regressions: 6 files, 108 tests passed.
- Full isolated PostgreSQL policy suite passed, including actual concurrent leave overlap and organization inventory races.
- Combined actual migration fixture passed for automation, retention, deletion, old-session denial, and foreign-tenant preservation.
- The generated SQL bundle matches all five migration sources.

These checks use local test fixtures and mocked external providers; they do not substitute for the hosted verification above. The production build retains existing lint warnings.
