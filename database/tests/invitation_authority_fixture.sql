alter table invitations add column token text default gen_random_uuid()::text, add column invited_by uuid, add column updated_at timestamptz;
grant select,insert,update,delete on invitations to authenticated;
create policy legacy_invitation_org on invitations for all to authenticated using(organization_id=public.auth_org() and not public.auth_is_client()) with check(organization_id=public.auth_org() and not public.auth_is_client());
