begin;
-- Live entity references obey the reader's current rights, including notices
-- inserted by trusted server workflows. Existing task/proof privacy remains
-- independently enforced by notifications_task_current_access.
create or replace function public.notification_entity_visible(p_project uuid,p_task uuid,p_submission uuid,p_entity_type text,p_entity_id text)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare org uuid:=public.auth_org(); actor uuid:=public.auth_app_user_id();
 profile text:=auth.jwt()->'app_metadata'->>'user_type'; member public.memberships%rowtype;
 project_ref uuid:=p_project; entity_ref uuid; project_row public.projects%rowtype;
 oversight boolean; project_role text;
begin
 if p_project is null and p_entity_type is distinct from 'project' and p_entity_type is distinct from 'team' and p_entity_type is distinct from 'employee' then return true; end if;
 select * into member from public.memberships where organization_id=org and user_id=actor and user_type=profile
  and status='active' and user_type in ('admin','developer') and role<>'client';
 if not found then return false; end if;
 if p_entity_type in ('project','team','employee') then
  entity_ref:=public.try_uuid(p_entity_id);
  if entity_ref is null then return false; end if;
 end if;
 if p_entity_type='project' then
  if project_ref is not null and project_ref<>entity_ref then return false; end if;
  project_ref:=entity_ref;
 end if;
 if project_ref is not null then
  select * into project_row from public.projects where id=project_ref and organization_id=org;
  if not found then return false; end if;
  -- Task/proof recipients may have independent task.review/bug.triage rights;
  -- their existing task privacy policy is authoritative for those notices.
  if p_task is null and p_submission is null and coalesce(p_entity_type,'') not in ('task','submission') then
   select pm.project_role into project_role from public.project_members pm
    where pm.organization_id=org and pm.project_id=project_ref and pm.user_id=actor and pm.user_type=profile;
   oversight:=coalesce(public.auth_override('project.view_all'),member.role in ('owner','admin','manager','team_lead')
     or coalesce(project_role in ('manager','team_lead'),false),false);
   if not oversight then
    if not coalesce(public.auth_override('project.view_own'),true) then return false; end if;
    if project_role is null
      and not coalesce(profile='developer' and coalesce(project_row.assigned_developer_id,project_row.assigned_to)=actor,false)
      and not coalesce((project_row.created_by=actor and project_row.created_by_type=profile)
        or (project_row.added_by=actor and project_row.added_by_type=profile)
        or (project_row.manager_id=actor and project_row.manager_type=profile),false)
      and not exists(select 1 from public.developer_tasks t where t.organization_id=org and t.project_id=project_ref
        and t.developer_id=actor and profile='developer') then return false; end if;
   end if;
  end if;
 end if;
 if p_entity_type='team' then
  if not exists(select 1 from public.teams t where t.id=entity_ref and t.organization_id=org) then return false; end if;
  oversight:=coalesce(public.auth_override('team_stats.view'),member.role in ('owner','admin','hr'),false)
    or coalesce(public.auth_override('team.view'),member.role in ('owner','admin','manager','team_lead'),false);
  if not oversight and (not coalesce(public.auth_override('team.view_own'),true) or member.team_id is distinct from entity_ref) then return false; end if;
 elsif p_entity_type='employee' then
  if not coalesce(public.auth_override('member.view'),member.role in ('owner','admin','hr'),false) then return false; end if;
  if not exists(select 1 from public.memberships m where m.organization_id=org and m.user_id=entity_ref and m.user_type in ('admin','developer')) then return false; end if;
 end if;
 return true;
end $$;
revoke all on function public.notification_entity_visible(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.notification_entity_visible(uuid,uuid,uuid,text,text) to authenticated;
create policy notifications_entity_current_access on public.notifications as restrictive for select to authenticated
using(public.notification_entity_visible(project_id,task_id,submission_id,entity_type,entity_id::text));
commit;
