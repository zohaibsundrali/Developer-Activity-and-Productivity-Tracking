begin;
-- Membership identity is (organization_id,user_id,user_type), not a bare UUID.
-- Different profile tables may legitimately contain the same UUID.
create or replace function public.auth_override(p_key text) returns boolean
language sql stable security definer set search_path=pg_catalog,public
as $$ select up.allowed from public.user_permissions up
  join public.memberships m on m.id=up.membership_id
  where m.organization_id=public.auth_org() and m.user_id=public.auth_app_user_id()
    and m.user_type=auth.jwt()->'app_metadata'->>'user_type'
    and m.status='active' and up.permission_key=p_key limit 1 $$;
revoke all on function public.auth_override(text) from public;
grant execute on function public.auth_override(text) to authenticated;

create or replace function public.auth_project_staffing(p_project uuid,p_key text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public
as $$ declare project_role text; allowed boolean; begin
  if public.auth_is_client() or public.auth_org() is null or p_key is null or p_key not in ('project.manage_members','capacity.allocate') then return false; end if;
  if not exists(select 1 from public.projects where id=p_project and organization_id=public.auth_org()) then return false; end if;
  select pm.project_role into project_role from public.project_members pm
    where pm.project_id=p_project and pm.organization_id=public.auth_org() and pm.user_id=public.auth_app_user_id()
      and pm.user_type=auth.jwt()->'app_metadata'->>'user_type';
  allowed:=coalesce(public.auth_override(p_key),public.auth_role() in ('owner','admin','manager') or project_role='manager',false);
  if p_key='project.manage_members' then
    return allowed and (public.auth_role() in ('owner','admin') or project_role is not null);
  end if;
  -- Capacity's existing API is organization-wide for managers. Preserve it.
  return allowed;
end; $$;
commit;
