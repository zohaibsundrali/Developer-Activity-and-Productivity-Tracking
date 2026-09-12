# Transactional client invoicing

Approved hours now become an invoice in one database transaction. The database derives hours and rates from typed approved records, validates the selected project/client and checks invoice permissions and subscription write status. The header and lines commit together or roll back together. Typed identity separates Admin and Developer profiles sharing the same UUID.

Direct invoice/header/line writes enforce effective invoice permissions, organization ownership and derived amounts. Timesheet lines are immutable snapshots: void and recreate the invoice to correct them. Voiding releases hours; reactivating a void invoice cannot claim hours already billed elsewhere. Manual invoices remain supported, and moving/deleting manual lines updates both affected totals, including deletion of the final line.

Invoice storage access is restricted to the applicable invoice permissions. Client PDF downloads require an addressed, non-draft invoice in the caller's organization and an attachment inside that invoice's own folder. Missing records, invalid paths and temporary failures are distinguished; signed-link responses are private and not cached. Safe historical filenames in the correct folder remain supported.

Users can choose the client when creating a draft from hours, or assign an existing client to an unassigned draft later. The UI confirms the organization, invoice and changed values before reporting success. A failed PDF attachment is reported separately from a successfully saved invoice; uncertain objects are not deleted automatically.

Billable and P&L reads load complete pages or fail explicitly. No partial financial total is presented as complete. Manual invoices in different currencies are shown separately; there is no invented currency conversion. Revenue/margin is unavailable where currencies cannot be combined, and incomplete cost coverage does not produce a misleading margin. Existing USD rate semantics are retained.

## Apply this release

1. Confirm the preceding typed-timesheet release (PR #115) and existing invoicing schema (079) are installed.
2. Run the read-only `scripts/sql/invoice-identity-preflight.sql`. Returned groups need original identity evidence; do not guess ownership or delete historical invoices. The migration retains unresolved lines and prevents uncertain hours from being billed again.
3. In Supabase Storage, confirm the `invoices` bucket has **Public OFF**. The migration refuses a public bucket because public object URLs bypass RLS. Run the complete `supabase/migrations/20260912110551_production_transactional_typed_invoicing.sql` once.
4. Merge/deploy the matching web release in the same maintenance window. The new API requires its transactional RPC and typed view columns. No desktop rebuild is needed.
5. Using disposable test records, verify a draft from approved hours, client assignment, publication and PDF download; check Finance and an explicitly denied Team Member. Check failure/retry behavior before relying on production billing.

The changes do not send payments, change Stripe subscriptions, reconstruct identities or remove existing storage objects. Existing signed links remain valid until their original expiry. Live provider/browser journeys and production data repair remain separate verification requirements.

Validation: 4,180 web tests passed across 205 files; production build passed. Full isolated PostgreSQL audit harness passed, including typed invoicing, direct permission/plan/privacy checks, legacy identity preservation, public-bucket refusal and real concurrent invoice/header/line/void tests. These are local automated tests, not a certification of live hosted user journeys.
