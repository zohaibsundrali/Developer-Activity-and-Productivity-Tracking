begin;
-- Stale signed claims and membership rows cannot authorize a detached or
-- relinked profile. Preserve deletion freezes and current typed membership.
create or replace function public.auth_org() returns uuid language sql stable security definer set search_path=pg_catalog,public,app_private as $$
 select m.organization_id from public.memberships m where auth.uid() is not null
 and m.organization_id=nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid
 and m.user_id=nullif(auth.jwt()->'app_metadata'->>'app_user_id','')::uuid
 and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.status='active' and not m.deletion_blocked
 and m.role=auth.jwt()->'app_metadata'->>'role'
 and public.role_rank(m.role) is not null and (m.user_type='client')=(m.role='client')
 and not app_private.organization_deleting(m.organization_id)
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now())
   and u.raw_app_meta_data->>'organization_id'=m.organization_id::text
   and u.raw_app_meta_data->>'app_user_id'=m.user_id::text
   and u.raw_app_meta_data->>'user_type'=m.user_type
   and u.raw_app_meta_data->>'role'=m.role)
 and ((m.user_type='admin' and exists(select 1 from public.admin_users p where p.id=m.user_id and p.organization_id=m.organization_id and p.auth_user_id=auth.uid()))
   or (m.user_type='developer' and exists(select 1 from public.developers p where p.id=m.user_id and p.organization_id=m.organization_id and p.auth_user_id=auth.uid()))
   or (m.user_type='client' and exists(select 1 from public.clients p where p.id=m.user_id and p.organization_id=m.organization_id and p.auth_user_id=auth.uid()))) limit 1;
$$;
create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.role
  from public.memberships m
  where auth.uid() is not null
    and m.organization_id=public.auth_org()
    and m.organization_id = nullif(auth.jwt()->'app_metadata'->>'organization_id', '')::uuid
    and m.user_id = nullif(auth.jwt()->'app_metadata'->>'app_user_id', '')::uuid
    and m.user_type = auth.jwt()->'app_metadata'->>'user_type'
    and m.status = 'active'
    and public.role_rank(m.role) is not null
    and public.role_rank(auth.jwt()->'app_metadata'->>'role') is not null
    and (m.user_type = 'client') = (m.role = 'client')
  limit 1;
$$;
revoke all on function public.auth_org(),public.auth_role() from public,anon;
grant execute on function public.auth_org(),public.auth_role() to authenticated;
commit;
