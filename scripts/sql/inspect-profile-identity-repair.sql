-- Read-only preview. Requires the operator identity repair migration.
-- Replace every placeholder using independently verified existing IDs.
-- user type must be admin, developer, or client (the profile table, not role).
-- No Auth accounts, profiles, memberships, emails or roles are created/changed.
select public.operator_repair_profile_identity(
 p_org => 'REPLACE_ORGANIZATION_UUID'::uuid,
 p_profile => 'REPLACE_EXISTING_PROFILE_UUID'::uuid,
 p_type => 'REPLACE_PROFILE_TYPE',
 p_auth => 'REPLACE_EXISTING_AUTH_UUID'::uuid,
 p_apply => false,
 p_allow_null_org => false
) as identity_repair_preview;
