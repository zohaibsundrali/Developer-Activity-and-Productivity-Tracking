# Platform administration suite

This extends the `/admin` platform console with organization suspension, membership management, project lifecycle controls, billing operations, reporting, health alerts, and delegated platform roles. Organization dashboards remain separate at `/admin/dashboard`.

## Deployment

Run `database/platform-admin-suite-setup.sql` once in the Supabase SQL Editor as the database owner before deploying the merged feature PR. The new application checks a database-backed live-session function on identity-only routes, so the SQL must be installed before that build receives traffic. The existing platform-owner migration and owner provisioning must already be installed. The combined file runs the three new migrations in a single transaction; if any step fails, no partial upgrade is committed. Do not rerun the original owner setup or reprovision the owner.

SQL changes alone do not configure external services. Existing Stripe credentials, the signed billing webhook endpoint, and the site's invitation email provider remain required for provider actions and email delivery. Enable `refund.created` and `refund.updated` on the existing Stripe webhook endpoint to include external refunds in analytics. Console-created successful refunds are recorded independently. `NEXT_PUBLIC_APP_URL` must be the canonical HTTPS application origin for invitation links.

## Access and identity

Platform owner, support and billing roles live in private tables linked to verified Supabase Auth identities. Tenant owner/admin roles cannot grant platform permissions. The owner can grant access to an existing verified login, remove access, set the role, and require MFA. Existing owner access is preserved. Newly granted team access defaults to MFA required. Owners can enroll an authenticator, verify a code, then require MFA for their own access.

Every platform operation checks the verified Auth identity, live session, private platform registry, capability and applicable MFA requirement. Data reads create access audit entries; mutations record the actor and reason. MFA enrollment and challenge use Supabase Auth, while backend authorization checks live session assurance and a verified factor. The platform does not expose recovery secrets or allow a staff member to grant themselves owner access.

Support can inspect organizations, manage workspace members/projects and view health. Billing staff can inspect organization billing, operate subscriptions/refunds and view revenue. Only owners manage platform team access and permanently delete whole organizations. Tenant permission overrides and platform permissions are separate namespaces.

## Organization, member and project operations

Organizations can be suspended and reactivated. Suspension is enforced through workspace authority and server authorization, not only by hiding navigation. The reason and actor are retained in the platform audit log.

Membership management supports search, invitations, role changes, workspace access revocation/restoration and revocation of existing application sessions across workspaces. Users can sign in again if their memberships remain active. Revocation does not delete Auth users. Last active workspace owners and platform identities are protected against accidental membership operations. Invitations return a shareable link and state whether email delivery succeeded.

Projects can be inspected, archived, restored or permanently deleted. Deletion requires the exact project name and a reason. Existing database referential actions determine dependent record handling, and protected references return a conflict. A narrowly scoped, reauthorized service transaction permits platform project maintenance while normal billing locks continue to protect tenant operations. Stored attachments are retained for the organization's storage lifecycle rather than blindly deleting shared object paths.

## Billing and reporting

Plan changes use configured catalog Stripe prices with no prorations. Changing a billing interval can cause an immediate provider charge. Cancellation schedules the subscription to stop at period end. Trial extensions apply to an existing trial. Refunds are positive integer minor-unit amounts against a paid invoice belonging to the effective billing account. Shared-account workspaces resolve to the same original subscription, where that optional migration is installed.

Billing requests carry stable UUID idempotency keys and durable request/result audit entries. Uncertain provider outcomes remain pending to prevent a new request from double-applying a charge/refund. Retry an original request with its original parameters; do not invent a new request ID after a timeout. Existing webhook processing remains the authority for provider-backed subscription mirrors.

CSV and PDF exports apply organization, date, status and search filters, fetch all matching pages and reject exports over 10,000 rows with a request to narrow filters. CSV values are escaped against spreadsheet formula execution. Date filters use UTC and include the whole selected end date. Financial values remain separated by currency.

MRR and ARR are current catalog-based estimates, excluding trials, usage, discounts, tax and quantity adjustments. Collections use mirrored invoice dates; outstanding amounts are current open invoices. Refund-adjusted collections include successful console refunds and captured refund webhook events. Churn uses retained subscription rows and their end dates; deleted/replaced historical records can make it incomplete. These definitions are displayed in the console rather than presenting estimates as audited revenue.

## Health and alerts

Health reports actual failed billing webhook records, pending cleanup jobs, device heartbeat age and storage-object metadata totals. Lists are bounded and show that limit. Unknown storage sizes are reported as unavailable. A stale heartbeat indicates an offline or inactive device and is not evidence by itself of a failed tracker sync.

In-app alerts cover failed subscription payments, trials ending within seven days and failed cleanup attempts. Acknowledgements are stored per platform user; a new occurrence produces a new alert. Alerts are evaluated on page refresh. This release does not send new external emails or SMS alerts.

## Validation

Verification covers API authorization, input validation, provider scope and idempotency, exports, database permissions and actual transactional actions, production compilation, and mocked browser flows. No production refunds, invitations, account revocations or deletion actions are performed during these checks.

Reproduce database integration in a disposable PostgreSQL instance with the repository mounted at `/workspace`:

```sh
psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/platform_suite.sql
```

This fixture installs the prior console, runs the exact combined SQL Editor bundle, then exercises management, project and billing assertions. Never run files under `database/tests` against production. Only `database/platform-admin-suite-setup.sql` is the production upgrade.

Regenerate the combined file after migration edits with `python3 scripts/build-platform-admin-sql.py`. Export rows are read from live paginated data; concurrent writes can affect consistency, so exports are operational reports rather than transaction snapshots.
