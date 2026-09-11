-- A visibility grant permits only publication of already-readable tasks.
-- It grants neither task reads nor general management. Explicit denies apply
-- on INSERT as well as UPDATE, including managers and owners.
begin;
create or replace function public.auth_task_capability(p_key text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.auth_org() is not null and not public.auth_is_client()
    and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
    and coalesce(public.auth_override(p_key),case
      when p_key='task.set_client_visibility' then public.auth_role() in ('owner','admin','manager')
      when p_key in ('task.manage','task.view_all') then public.auth_role() in ('owner','admin','manager','team_lead')
      when p_key in ('task.review','bug.raise','bug.triage') then public.auth_role() in ('owner','admin','manager','team_lead','qa')
      when p_key in ('task.view_own','task.update_own') then public.auth_role() in
        ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee')
      else false end,false)
    and p_key in ('task.manage','task.view_all','task.review','bug.raise','bug.triage','task.view_own','task.update_own','task.set_client_visibility');
$$;
create or replace function public.auth_task_access(p_org uuid,p_project uuid,p_developer uuid,p_kind text,p_visible boolean,p_action text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare own_task boolean; begin
  if p_org is distinct from public.auth_org() or public.auth_org() is null then return false; end if;
  if public.auth_is_client() then
    return p_action='read' and coalesce(p_visible,false) and public.auth_plan_feature('client_portal')
      and p_project in (select public.auth_client_project_ids());
  end if;
  own_task:=auth.jwt()->'app_metadata'->>'user_type'='developer' and p_developer=public.auth_app_user_id();
  if p_action='read' then return public.auth_task_capability('task.view_all') or public.auth_task_capability('task.review')
    or (coalesce(own_task,false) and public.auth_task_capability('task.view_own'))
    or (p_kind='bug' and public.auth_task_capability('bug.triage')); end if;
  if public.auth_task_capability('task.manage') then return p_action in ('insert','update','delete'); end if;
  if p_action='insert' then return p_kind='bug' and public.auth_task_capability('bug.raise'); end if;
  if p_action='update' then return (public.auth_task_capability('task.set_client_visibility')
      and public.auth_task_access(p_org,p_project,p_developer,p_kind,p_visible,'read')) or (coalesce(own_task,false) and public.auth_task_capability('task.update_own'))
    or (p_kind='bug' and public.auth_task_capability('bug.triage')); end if;
  if p_action='delete' then return coalesce(own_task,false) and public.auth_task_plan_edit(p_project); end if;
  return false;
end $$;
create or replace function public.guard_task_authority_fields() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare allowed_fields text[]; field text; own_task boolean; manager boolean; begin
  if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
  manager:=public.auth_task_capability('task.manage');
  if not public.auth_task_project_valid(new.project_id,new.organization_id) then
    raise exception 'Task project must belong to this organization' using errcode='42501'; end if;
  if tg_op='INSERT' or new.developer_id is distinct from old.developer_id then
    if new.developer_id is not null and not exists(select 1 from public.memberships where organization_id=new.organization_id
      and user_id=new.developer_id and user_type='developer' and status='active' and role<>'client') then
      raise exception 'Task assignee must be active staff in this organization' using errcode='42501'; end if;
  end if;
  if tg_op='INSERT' then
    if not manager and (new.task_type is distinct from 'bug' or new.developer_id is not null
      or new.client_visible or new.status is distinct from 'pending'
      or new.reported_by is distinct from public.auth_app_user_id()) then
      raise exception 'Defect creation cannot assign or publish work' using errcode='42501'; end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id or new.project_id is distinct from old.project_id then
    raise exception 'Task identity and project are immutable' using errcode='42501'; end if;
  -- Match pmData's hand-driven status pipeline. Verdicts remain exclusively
  -- in the existing review integrity trigger and service transaction.
  if new.status is distinct from old.status and not coalesce(new.status=any(case coalesce(old.status,'pending')
    when 'pending' then array['in_progress','awaiting_approval']
    when 'in_progress' then array['pending','awaiting_approval']
    when 'awaiting_approval' then array['in_progress','reviewed']
    when 'reviewed' then array['awaiting_approval','in_progress']
    when 'rejected' then array['in_progress'] else array[]::text[] end),false) then
    raise exception 'Task status requires the workflow transition' using errcode='42501'; end if;
  if manager then return new; end if;
  own_task:=auth.jwt()->'app_metadata'->>'user_type'='developer' and old.developer_id=public.auth_app_user_id()
    and public.auth_task_capability('task.update_own');
  allowed_fields:=array['updated_at'];
  if public.auth_task_capability('task.set_client_visibility') then
    allowed_fields:=allowed_fields || array['client_visible']; end if;
  if coalesce(own_task,false) or (old.task_type='bug' and public.auth_task_capability('bug.triage')) then
    allowed_fields:=allowed_fields || array['status']; end if;
  if coalesce(own_task,false) and public.auth_task_plan_edit(old.project_id) then
    allowed_fields:=allowed_fields || array['task_title','task_description','start_date','end_date']; end if;
  for field in select key from jsonb_each(to_jsonb(new)) where value is distinct from to_jsonb(old)->key loop
    if not field=any(allowed_fields) then raise exception 'Task field requires management permission: %',field using errcode='42501'; end if;
  end loop;
  return new;
end $$;
create or replace function public.developer_tasks_guard_client_visibility()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
  if tg_op='INSERT' then
    if not coalesce(new.client_visible,false) then return new; end if;
  elsif new.client_visible is not distinct from old.client_visible then return new;
  end if;
  if not coalesce(public.auth_task_capability('task.set_client_visibility'),false) then
    raise exception 'permission denied: task.set_client_visibility' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.developer_tasks_guard_client_visibility() from public;
drop trigger if exists trg_developer_tasks_client_visibility_guard on public.developer_tasks;
create trigger trg_developer_tasks_client_visibility_guard before insert or update on public.developer_tasks
for each row execute function public.developer_tasks_guard_client_visibility();
commit;
