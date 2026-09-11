begin;
-- Match the catalogue resolver plus mayActOnProject. SECURITY DEFINER avoids
-- recursive project_members policy reads; identity always comes from the JWT.
create or replace function public.auth_project_staffing(p_project uuid,p_key text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public
as $$ declare project_role text; allowed boolean; begin
  if public.auth_is_client() or public.auth_org() is null or p_key not in ('project.manage_members','capacity.allocate') then return false; end if;
  if not exists(select 1 from public.projects where id=p_project and organization_id=public.auth_org()) then return false; end if;
  select pm.project_role into project_role from public.project_members pm
    where pm.project_id=p_project and pm.organization_id=public.auth_org() and pm.user_id=public.auth_app_user_id();
  allowed:=coalesce(public.auth_override(p_key),public.auth_role() in ('owner','admin','manager') or project_role='manager',false);
  if p_key='project.manage_members' then
    return allowed and (public.auth_role() in ('owner','admin') or project_role is not null);
  end if;
  -- Capacity's existing API is organization-wide for managers. Preserve it.
  return allowed;
end; $$;
revoke all on function public.auth_project_staffing(uuid,text) from public;
grant execute on function public.auth_project_staffing(uuid,text) to authenticated;

drop policy if exists project_members_write on public.project_members;
create policy project_members_insert on public.project_members for insert to authenticated
  with check(organization_id=public.auth_org() and public.auth_org_unlocked() and public.auth_project_staffing(project_id,'project.manage_members'));
create policy project_members_update on public.project_members for update to authenticated
  using(organization_id=public.auth_org() and (public.auth_project_staffing(project_id,'project.manage_members') or public.auth_project_staffing(project_id,'capacity.allocate')))
  with check(organization_id=public.auth_org() and public.auth_org_unlocked());
create policy project_members_delete on public.project_members for delete to authenticated
  using(organization_id=public.auth_org() and public.auth_org_unlocked() and public.auth_project_staffing(project_id,'project.manage_members'));

create or replace function public.guard_project_staffing_fields() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public
as $$ declare trusted boolean:=current_user in ('postgres','service_role','supabase_admin'); column_name text; begin
  if tg_op='DELETE' then
    if not trusted and old.project_role='manager' and exists(select 1 from public.projects where id=old.project_id) then
      raise exception 'Assign a different manager before removing this member' using errcode='42501';
    end if;
    return old;
  end if;
  if not exists(select 1 from public.projects where id=new.project_id and organization_id=new.organization_id) then
    raise exception 'Project must belong to the membership organization' using errcode='23514';
  end if;
  if tg_op='INSERT' or (new.user_id,new.user_type,new.organization_id) is distinct from (old.user_id,old.user_type,old.organization_id) then
    if not exists(select 1 from public.memberships where organization_id=new.organization_id and user_id=new.user_id
      and user_type=new.user_type and user_type<>'client' and status='active') then
      raise exception 'Project team requires an active staff membership' using errcode='23514';
    end if;
  end if;
  if trusted then return new; end if;
  if tg_op='INSERT' then
    if new.allocation_pct is not null and not public.auth_project_staffing(new.project_id,'capacity.allocate') then
      raise exception 'permission denied: capacity.allocate' using errcode='42501';
    end if;
    return new;
  end if;
  if old.project_role='manager' and new.project_role<>'manager' then
    raise exception 'Assign a different manager before changing this role' using errcode='42501';
  end if;
  for column_name in select key from jsonb_each(to_jsonb(new)) where value is distinct from to_jsonb(old)->key loop
    if column_name='updated_at' then continue; end if;
    if column_name in ('id','organization_id','project_id','user_id','user_type','created_at','added_by') then
      raise exception 'permission denied: immutable project membership identity' using errcode='42501';
    elsif column_name='allocation_pct' then
      if not public.auth_project_staffing(new.project_id,'capacity.allocate') then raise exception 'permission denied: capacity.allocate' using errcode='42501'; end if;
    elsif not public.auth_project_staffing(new.project_id,'project.manage_members') then
      raise exception 'permission denied: project.manage_members' using errcode='42501';
    end if;
  end loop;
  return new;
end; $$;
create trigger project_staffing_fields before insert or update or delete on public.project_members
  for each row execute function public.guard_project_staffing_fields();
commit;
