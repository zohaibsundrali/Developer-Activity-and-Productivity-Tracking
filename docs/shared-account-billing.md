# Shared account billing

Signed-in users create an organization at `/create/organization`. The form has
its heading on the left and details on the right, stacks on small screens, and
submits directly with **Create organization**. It does not request credentials,
email verification or another plan. Signed-in visits to `/admin/registration`
redirect to the new route. Public registration retains verification and plan
selection for the first account.

## Subscription and usage

The first organization is the billing anchor for its verified owner's Auth
identity. Its subscription, Stripe customer, subscription identifiers and invoice
history remain unchanged. Other organizations owned/created by that identity
share this subscription. Organizations where someone is merely an invited member
are not added to their personal billing account.

Private account/mapping tables are inaccessible to browser roles. Server-side
billing resolution uses the verified workspace, never a client-supplied account
ID. Organization data and role permissions remain scoped to the selected
workspace; sharing billing does not grant access to another workspace.

Project, employee membership, developer profile, active-task, screenshot and
storage usage are summed across the account. The existing counting definitions
are preserved: an employee membership in two organizations consumes two
membership seats. Closing tasks or removing resources releases their capacity.
A quota lock shared by all account organizations serializes resource increases
and subscription changes, including direct database writes. Existing over-limit
rows are preserved after a downgrade; further increases are refused.

Feature access, tracking history, trial expiry, payment failure and cancellation
all resolve the same subscription. Creating an organization never restarts a
trial. Public first-time signup continues to select its initial plan.

Only the account payer may purchase, change or cancel the shared plan, in
addition to the existing billing permission check. Delegated billing readers
use the original organization. A secondary organization's owner/admin role alone
does not expose the payer's invoices/card information or payment controls.

## Deletion and migration boundaries

Deleting a secondary organization does not cancel the account subscription.
The original billing organization must be deleted last. Both the deletion job
and direct organization deletion are blocked while other account organizations
remain, before any external billing cancellation or membership freeze.

The migration chooses the earliest organization for each linked owner identity.
It refuses to merge a secondary organization that already has a non-Free plan,
Stripe customer or Stripe subscription. Reconcile those subscriptions explicitly
before retrying; the migration never cancels or silently discards paid billing.
Legacy organizations with no linked owner identity remain separate accounts.

## Deploy

1. Back up and review existing subscriptions, especially owners with multiple
   organizations and independent paid plans.
2. Apply `20260920070343_shared_account_billing.sql` after the authenticated
   workspace migration. It is transactional and briefly locks the organization
   and subscription tables while backfilling mappings.
3. Deploy the corresponding application changes. The existing access-token hook
   remains enabled; this change does not replace it.
4. Test an owner's two organizations, their combined usage, workspace isolation,
   denied billing access for another owner, and a subscription update in the
   configured Stripe test environment before live billing rollout.

The migration was applied to the target Verisade project during the 21 September
QA repair; see `qa-all-roles-2026-09-21.md` for validation and the storage repair.
Hosted Stripe payment operations were not exercised. No new payment/tax settings
or charges were introduced.
Do not roll back just the application or mapping tables: secondary organizations
no longer have independent subscription rows.

## Verification

- `database/tests/shared_account_billing.sql`: migration, shared subscription,
  ignored extra trial requests, creation retries, combined project/storage
  limits, unpaid lock, private grants, and billing-anchor deletion protection.
- `scripts/test-shared-billing-concurrency.py <container> <database>`: isolated
  fixture only; two organizations cannot concurrently consume the last quota
  slot twice.
- `tests/sharedAccountBilling.test.js`: canonical subscription/customer selection,
  combined count filters, payer authority and failed/foreign scope lookups.
- `scripts/test-organization-browser.cjs`: mocked API browser checks, including
  canonical creation route, old-route redirect, direct creation without plan
  selection, responsive layout, white dark-theme action labels, public signup,
  logout, and workspace switching.

Supabase security advisors on the disposable fixture found no issues in the new
billing objects. Five mutable-search-path warnings belong to fixture-only helper
functions, not the production migration.
