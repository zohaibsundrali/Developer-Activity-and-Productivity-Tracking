-- Apply after database/096. RLS must revoke access immediately when a
-- membership is removed/suspended, even while an old access token is valid.
-- Definer lookup is necessary to avoid recursively evaluating memberships RLS.
-- Only identity from the verified JWT is consulted; callers cannot choose IDs.
begin;
create or replace function public.auth_org() returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.organization_id
  from public.memberships m
  where auth.uid() is not null
    and m.organization_id = nullif(auth.jwt()->'app_metadata'->>'organization_id', '')::uuid
    and m.user_id = nullif(auth.jwt()->'app_metadata'->>'app_user_id', '')::uuid
    and m.user_type = auth.jwt()->'app_metadata'->>'user_type'
    and m.status = 'active'
    and public.role_rank(m.role) is not null
    and (m.user_type = 'client') = (m.role = 'client')
  limit 1;
$$;

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when public.role_rank(auth.jwt()->'app_metadata'->>'role') < public.role_rank(m.role)
      then auth.jwt()->'app_metadata'->>'role'
    else m.role
  end
  from public.memberships m
  where auth.uid() is not null
    and m.organization_id = nullif(auth.jwt()->'app_metadata'->>'organization_id', '')::uuid
    and m.user_id = nullif(auth.jwt()->'app_metadata'->>'app_user_id', '')::uuid
    and m.user_type = auth.jwt()->'app_metadata'->>'user_type'
    and m.status = 'active'
    and public.role_rank(m.role) is not null
    and public.role_rank(auth.jwt()->'app_metadata'->>'role') is not null
    and (m.user_type = 'client') = (m.role = 'client')
  limit 1;
$$;
revoke all on function public.auth_org() from public;
revoke all on function public.auth_role() from public;
grant execute on function public.auth_org(), public.auth_role() to authenticated;
commit;
