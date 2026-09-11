-- Narrow action-specific field checks; keep existing row scope and role-rank
-- guards. A grant to activate must not grant team transfer or contracted hours.
begin;
create or replace function public.auth_people_permission(p_key text) returns boolean
language sql stable security definer set search_path=pg_catalog,public
as $$ select public.auth_org() is not null and case
  when p_key='organization.manage' then coalesce(public.auth_override(p_key),public.auth_role()='owner',false)
  when p_key in ('member.manage','employee.manage','employee.activate','employee.transfer','hierarchy.manage','employment.set_hours') then
    coalesce(public.auth_override(p_key),public.auth_role() in ('owner','admin','hr'),false)
  else false end $$;
revoke all on function public.auth_people_permission(text) from public;
grant execute on function public.auth_people_permission(text) to authenticated;

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
  using(id=public.auth_org() and public.auth_people_permission('organization.manage'))
  with check(id=public.auth_org());

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated
  using(organization_id=public.auth_org() and (
    public.auth_people_permission('member.manage') or public.auth_people_permission('employee.activate')
    or public.auth_people_permission('employee.transfer') or public.auth_people_permission('hierarchy.manage')))
  with check(organization_id=public.auth_org() and (role<>'owner' or public.auth_role()='owner'));

drop policy if exists employee_profiles_update on public.employee_profiles;
create policy employee_profiles_update on public.employee_profiles for update to authenticated
  using(organization_id=public.auth_org() and (
    public.auth_people_permission('employee.manage') or public.auth_people_permission('employee.activate')
    or public.auth_people_permission('employee.transfer') or public.auth_people_permission('employment.set_hours')))
  with check(organization_id=public.auth_org());

create or replace function public.guard_people_fields() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare before_row jsonb:=to_jsonb(old); after_row jsonb:=to_jsonb(new); field text; permission text;
begin
  if current_user in ('postgres','service_role','supabase_admin','supabase_auth_admin') then return new; end if;
  for field in select key from jsonb_each(after_row) where value is distinct from before_row->key loop
    if field='updated_at' then continue; end if;
    if field in ('id','organization_id','user_id','user_type','membership_id','auth_user_id','created_at') then
      raise exception 'permission denied: immutable employee identity' using errcode='42501';
    end if;
    permission:=case
      when field in ('status','employment_status') then 'employee.activate'
      when field in ('team_id','department_id') then 'employee.transfer'
      when field='reports_to' then 'hierarchy.manage'
      when field='weekly_hours' then 'employment.set_hours'
      when tg_table_name='memberships' then 'member.manage'
      else 'employee.manage' end;
    if not public.auth_people_permission(permission) then
      raise exception 'permission denied: %',permission using errcode='42501';
    end if;
  end loop;
  return new;
end; $$;
create trigger people_field_permissions before update on public.memberships
  for each row execute function public.guard_people_fields();
create trigger people_field_permissions before update on public.employee_profiles
  for each row execute function public.guard_people_fields();
-- Client change requests use the API, which strips internal PM notes. Deny
-- direct client access to the source table so SELECT * cannot expose them.
create policy change_request_client_api_only on public.change_requests as restrictive for all to authenticated
  using(not public.auth_is_client()) with check(not public.auth_is_client());
commit;
