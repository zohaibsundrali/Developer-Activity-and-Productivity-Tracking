# Explicit operator repair of an existing identity

Apply `20260912043321_production_reserved_profile_provisioning.sql` and then `20260912043604_production_operator_identity_repair.sql` before using this tool. These migrations do not repair any user automatically.

This recovery is for a verified existing Auth account, existing typed profile and existing active membership. It repairs a missing profile `auth_user_id`, or—only with explicit opt-in—a missing profile `organization_id`. An already correct Auth link is preserved during null-organization recovery. It never creates a missing profile, membership or Auth account; it never overwrites a conflicting nonnull link/organization, changes email/role, or restamps Auth metadata.

An operator with Supabase SQL access or service credentials performs the workflow. `anon` and `authenticated` cannot invoke it; the login and self-service claim repair routes do not call it. Never put service credentials in the browser or chat.

1. `scripts/sql/legacy-identity-candidates.sql` can list candidate IDs and missing/conflicting fields without returning email addresses or credentials. It is only an investigation aid, not proof that a detached account should regain access. Independently identify the organization UUID, profile UUID and table type (`admin`, `developer`, `client`), and existing Auth UUID. Check existing provisioning/support records. An email match alone is insufficient; do not invent missing records or edit metadata just to make validation pass.
2. Run `scripts/sql/inspect-profile-identity-repair.sql` after replacing all four placeholders. It defaults to preview and changes no rows. The function checks confirmed matching email across Auth/profile/membership, exact trusted Auth metadata, unique typed membership, absence of identity conflicts, active/not-banned status, and deletion/provisioning/invitation reservations.
3. If the profile organization is null, inspect the exact matching metadata and unique typed membership, then preview again with `p_allow_null_org => true`. This explicitly opts in to filling only the missing organization field. A nonnull conflicting organization always remains blocked.
4. Continue only when `eligible` is true and all independent evidence agrees. Apply the exact same IDs with the acknowledgment and a meaningful support/verification reference:

```sql
select public.operator_repair_profile_identity(
 p_org => 'REPLACE_ORGANIZATION_UUID'::uuid,
 p_profile => 'REPLACE_EXISTING_PROFILE_UUID'::uuid,
 p_type => 'REPLACE_PROFILE_TYPE',
 p_auth => 'REPLACE_EXISTING_AUTH_UUID'::uuid,
 p_apply => true,
 p_allow_null_org => false, -- true only for the separately verified null-org case
 p_ack => 'REPAIR VERIFIED EXISTING IDENTITY',
 p_operator_reference => 'REPLACE_WITH_VERIFIED_SUPPORT_CASE_REFERENCE'
);
```

The apply call locks and revalidates current data. Profile changes and the audit record commit together or both roll back. Success returns an `auditId`. Replaying a fully repaired identity is refused. Review the operator audit through SQL using that ID; it contains identifiers and the verification reference, no credential material.

Ask the affected user to sign out and sign in again, then verify their organization, role and intended access. Do not claim successful login from a migration marker or repair result alone.

Common refusals:

- `profile_missing`: existing profile does not exist. This tool cannot reconstruct it. Reconcile original onboarding/provisioning evidence separately.
- `trusted_metadata_disagrees`, conflicting nonnull fields, or ambiguous identities: manual investigation; no automatic choice is safe.
- `confirmed_auth_email_required`: actual email confirmation is required; phone confirmation is insufficient.
- `reserved_identity_requires_recovery`: resume the existing invitation/provisioning workflow instead of creating a competing link.
- `organization_deleting` / scheduled Auth deletion: resolve that existing lifecycle operation first.

No production repair is performed by these files or by the regression tests. Staging/provider verification remains necessary.
