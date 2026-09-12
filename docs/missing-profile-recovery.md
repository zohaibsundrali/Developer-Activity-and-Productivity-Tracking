# Investigating missing Admin and Client profiles

Run `scripts/sql/missing-profile-recovery-evidence.sql` in the Supabase SQL Editor as a trusted operator. It is a SELECT-only diagnostic for active Admin/Client memberships whose exact typed profile is missing or belongs to another organization. Run it after the invitation transactions, organization deletion, reserved profile provisioning, and transactional signup migrations have been applied.

Before the diagnostic, confirm the required ledgers exist with this read-only check. If any result is null, stop and reconcile the corresponding migration using the deployment verification guide; do not replay an already-started bundle.

```sql
select
 to_regclass('app_private.invitation_attempts') as invitation_ledger,
 to_regclass('app_private.profile_provisioning') as provisioning_ledger,
 to_regclass('app_private.signup_attempts') as signup_ledger,
 to_regclass('app_private.organization_deletions') as deletion_ledger;
```

Optional organization owner/status fields are read through JSON and reported with separate `*_field_present` flags. A missing field or null owner pointer is unavailable evidence, not proof of ownership. An absent status prevents recommending restoration before lifecycle reconciliation.

The output compares exact organization/profile/type identifiers against trusted Auth metadata and original signup, provisioning and invitation reservations. It reports IDs, timestamps, completion states, presence of required signup fields, and matching-email booleans. It deliberately omits email addresses, personal signup fields, passwords, tokens, verification grants/hashes, lease claims and full Auth metadata. Keep even this identifier-only output restricted to the operators working on the case.

`automatic_reconstruction_allowed` is always false. An original record or matching metadata can support investigation; neither is sufficient authorization to recreate a missing identity. In particular, `reserved_auth_exists` does not mean the account is confirmed, enabled, uniquely linked, or matches the reservation. Review the separate Auth flags, role/email matches and reservation metadata checks.

Use the result as follows:

- **Organization missing, suspended, or deleting:** reconcile the organization/lifecycle operation first. Do not restore access around a deletion or suspension.
- **Profile exists under a different organization:** investigate the conflicting tenant. The diagnostic does not move it. The existing identity repair tool only supports separately verified null-organization recovery, never overwriting another organization.
- **Original signup record found:** inspect the original record and a verified backup/support case privately. Its field-presence flags do not expose or independently validate the original values. A completed signup finalizer does not recreate a subsequently missing profile; an incomplete finalizer must not be replayed over an existing organization. Prepare a separately reviewed restoration transaction if the evidence warrants it.
- **Provisioning or invitation reservation found:** inspect its exact role/type, reserved Auth ID, completion state and original authorized onboarding record. Provisioning requires the original profile to exist, and invitation finalization can conflict with existing membership rows. Do not call either finalizer merely because a reservation exists.
- **No matching Auth candidate:** first establish the original identity from onboarding records or a verified backup. Do not manufacture an Auth account from an owner pointer or membership UUID. Creation of any replacement credential requires a separately authorized account recovery workflow and delivery to the verified mailbox.
- **Multiple candidates, shared Auth links, cross-organization memberships, role/email disagreement, or disabled/unconfirmed Auth:** resolve the conflict before any restoration. Email similarity alone must never choose the identity.
- **No original record:** obtain the original onboarding record or verified backup. Absence of a ledger can be expected for legacy accounts; it is not permission to guess missing profile values.

The existing `operator_repair_profile_identity` tool remains appropriate only after the required original typed profile, active membership, and verified Auth identity exist and agree. It repairs missing links; it cannot create missing profiles or Auth accounts. After an explicitly reviewed recovery, re-run the diagnostic and test an actual sign-out/sign-in, organization selection, intended role access and denied cross-tenant access. A diagnostic or repair response alone does not prove login success.

These files perform no production repair. No email or Auth provider action is triggered.

Local verification: `npx vitest run tests/missingProfileRecoveryEvidence.test.js` checks the SELECT-only contract. `bash scripts/test-missing-profile-evidence.sh` runs synthetic records in an isolated PostgreSQL container, executes the diagnostic inside a read-only transaction, checks provenance/conflict classifications and sensitive-field omission, then verifies compatibility with absent optional organization columns. It does not connect to Supabase.
