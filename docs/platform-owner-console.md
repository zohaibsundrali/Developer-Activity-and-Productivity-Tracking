# Verisade platform owner console

`/admin` is the platform console. `/admin/dashboard` remains the organization dashboard. The shell inherits Inter, Space Grotesk and the site's light/dark palette. Confirmed platform owners are directed here after login and when returning to `/`.

## Access and deployment

Apply `20260920105039_platform_owner_console.sql` after the authenticated-workspaces and organization-deletion lifecycle migrations. The shared-account billing migration is optional; when present, detail and invoice views resolve the original billing organization.

Run `database/provision-platform-owner.sql` in the target project's SQL Editor as postgres to grant the explicitly approved, verified account. This grants a private Auth-ID-based capability, not a membership role. Revoke by deleting that ID from `app_private.platform_owners`. Browser claims, organization-owner membership, and editable user metadata cannot grant this capability.

Every API validates the bearer token with Supabase Auth, then checks the private owner registry and a live, unexpired `auth.sessions` row. Every reporting/destructive RPC repeats that check. RPC execution is limited to service_role; private tables have RLS and no API-role grants. Without the migration or grant the console denies access.

## Reporting

Overview includes organizations, projects, active workspace memberships (not distinct people), tasks, admin/staff/client profiles, devices, screenshots, pending cleanups, six calendar months of workspace creation, subscription states, and paid invoice totals grouped by currency. Totals are database aggregates, independent of PostgREST's row cap. Financial values are synced invoice records, not a live Stripe balance or projected MRR.

Organization search is literal, bounded and paginated. Organization details include workspace stats, metadata, projects, memberships, effective subscription and invoice history. Billing records are paginated across the platform. Missing subscription records and unavailable requests are explicit; they are not displayed as free plans or zero totals.

## Deletion

Deleting an organization requires its exact name and a reason. The backend queues the existing leased cleanup lifecycle; it does not directly delete database, Auth or Storage rows. Audit history retains the real platform actor. The worker handles billing cancellation, storage, exclusive Auth identities and database cleanup. Shared-account anchor restrictions and ambiguous-storage checks remain in force. Platform-owner Auth identities are retained. Activity shows up to 100 pending jobs with their total and paginates the audit log; cron or Run cleanup step advances a job.

Deletion does not reset the entire database. Individual people/project deletion and arbitrary billing plan/payment changes are not exposed by this platform console.

## Verification

Unit tests cover API authorization failures, server-derived actor/session, validation, pagination, shared billing scoping and cleanup dispatch. `database/tests/platform_owner_console.sql` runs the actual migration against the disposable lifecycle fixture and exercises owner/session isolation, permissions, totals and audited deletion. Browser checks should cover desktop/mobile, light/dark, denied access, search/detail tabs and exact-name deletion confirmation using mocked requests.

Run browser checks with a local server running:

```sh
E2E_BASE_URL=http://127.0.0.1:3000 node scripts/test-platform-browser.cjs
```

The script mocks all platform endpoints, never runs real deletion requests, and saves theme/mobile screenshots under `test-results/platform-owner`.
