# Account provisioning and recovery follow-up

PR #103's strict identity check exposed an existing provisioning defect: the staff/client Auth creation endpoint did not persist the profile Auth link. Signup also ignored failed organization, membership and Auth-link writes. A successful Auth password login therefore did not establish a working workspace identity.

## Changes

- Staff/client provisioning reserves one exact Auth UUID before contacting the provider. Completion verifies its typed organization/profile/role/email and persists membership consistently. Retries preserve the saved profile and original password; they do not adopt another account by email. Pending attempts have scoped status and bounded background finalization.
- A successful email-code check issues a private, single-use signup grant. The signup transaction requires its hash; a globally verified address alone is not proof that the caller verified it. Registration uses the actual six-digit code and no longer collects demo card details.
- Signup reserves immutable organization/profile/Auth IDs, original plan trial dates and consent evidence. Finalization commits the owner profile, organization, subscription, membership and Terms evidence together. Lost responses and interrupted Auth creation retain recoverable state. A retry requires fresh email verification and the original password; existing passwords are never reset by signup.
- An explicit service-only operator tool previews and repairs proven missing links. It cannot invent a missing profile or overwrite conflicting identities. Its audit commits with the repair. No account is automatically relinked during login.
- Self-service claim repair requires an existing matching typed Auth/profile link and active membership. It supports linked clients and refuses ambiguous or unavailable lookups. Numeric rank alone cannot authorize a role change that adds capabilities.
- Login reads only the profile named by the successful Auth identity, checks the exact link, distinguishes workspace verification failure from bad credentials, and requires a confirmed permission set before opening a dashboard.

- Recurring task generation commits the new occurrence, template cursor and activity together, preventing duplicate tasks after a timeout or overlapping cron invocation. Failed scheduled jobs return an unsuccessful result instead of a false success.
- Cron Supabase requests and deletion Stripe requests have explicit network deadlines; failed or uncertain operations retain their recovery records. Count limits and request deadlines do not guarantee a fixed total run duration.
- Organization deletion also removes completed private signup records containing personal details. Pending reservations retain their recovery state.

## Deployment and SQL

Use a maintenance window and verified backups. Do not replay the PR #102 bundle. Check migration history and apply each missing migration once with the matching application release:

Previous PR #103 migrations, if not already applied:

1. `supabase/migrations/20260912035637_production_current_profile_authority.sql`
2. `supabase/migrations/20260912035950_production_invitation_cleanup_confirmation.sql`

This follow-up:

3. `supabase/migrations/20260912043321_production_reserved_profile_provisioning.sql`
4. `supabase/migrations/20260912043604_production_operator_identity_repair.sql`
5. `supabase/migrations/20260912043622_production_transactional_signup_recovery.sql`
6. `supabase/migrations/20260912044800_production_atomic_recurring_tasks.sql`
7. `supabase/migrations/20260912044958_production_completed_signup_cleanup.sql`

Run `scripts/sql/current-identity-preflight.sql` before the release to identify inconsistencies. Prepare verified recovery for affected identities before enforcing the strict guard; users with inconsistent links will be refused. Follow [the operator repair guide](operator-profile-identity-repair.md) for explicit, individually verified repairs. Installing a migration changes no legacy user's identity automatically. Never disable the strict check or bulk copy email matches to restore access.

Deploy the matching web code only with the required database functions installed. Keep the existing protected `/api/cron` scheduler and `CRON_SECRET` configured. The checked-in schedule runs daily: unattended recovery is eventual, while the user can retry immediately through the existing form. No signup password is available to the worker, so it can finalize an existing reserved Auth account but cannot create one whose provider call never succeeded.

An uncommon provider-side email conflict after an Auth ID has been reserved still requires operator reconciliation. The application keeps the reservation and blocks unsafe profile/organization deletion; elapsed time alone cannot prove that an in-flight Auth creation will never complete.

## Live evidence and limitations

Read-only checks of the existing seeded QA accounts on 12 September found nine staff profiles with matching organization IDs but missing Auth links. The Owner, Admin and Client profiles were absent at their claimed typed IDs. These are findings about seeded QA identities, not a count of all production customers. No profiles, claims or customer data were changed to make the tests pass.

After PR #103 merged, the seeded Developer's Auth login succeeded, `/api/me/permissions` returned 401, while database `auth_org()` still returned its claimed organization. This demonstrates that the deployed API and database identity enforcement did not agree at the time of the probe. A successful migration-marker query is insufficient to resolve that discrepancy. Apply/verify the corresponding database guard and repair proven identities, then rerun direct API/database authorization tests.

Missing QA profiles require reconciliation with their original provisioning records or a fresh disposable QA tenant through the product. This repair tool deliberately cannot reconstruct them. Full live browser regression remains unverified until usable QA identities exist.

External checks still required: actual invitation/recovery email delivery, Stripe test checkout/webhooks/cancellation and plan transitions, hosted scheduler execution, disposable organization Auth/Storage deletion and retention, and Windows/macOS desktop capture/session expiry. Desktop PR #3 has merged; install/restart that desktop release separately. Do not treat local mocks or a successful build as proof of provider delivery or production readiness.

## Validation

Final web regression: 185 files / 3,936 tests passed. The complete isolated PostgreSQL authorization/recovery suite passed, including simultaneous signup claims, parallel incorrect-code accounting, operator-repair races, recurring-task races and deletion inventory concurrency. The final production build result is recorded in the pull request; existing lint warnings remain. Tests use disposable databases, actual migration SQL, provider-outcome fixtures and failure injection; they do not mutate hosted Supabase.
