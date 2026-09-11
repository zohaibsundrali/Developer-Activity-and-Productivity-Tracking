begin;
-- Internal service transaction: the HTTP boundary supplies the verified developer
-- identity. Existing tasks are preserved; only project submission state changes.
create or replace function public.submit_existing_task_plan(p_org uuid,p_project uuid,p_developer uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare project_row public.projects%rowtype; member_id uuid;
begin
 perform app_private.lock_quota(p_org);
 if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 select id into member_id from public.memberships where organization_id=p_org and user_id=p_developer
  and user_type='developer' and status='active' and role<>'client' for share;
 if member_id is null or exists(select 1 from public.user_permissions where membership_id=member_id
  and permission_key='task.update_own' and allowed=false) then
  raise exception 'PLAN_FORBIDDEN: active contributor permission required' using errcode='42501'; end if;
 select * into project_row from public.projects where id=p_project and organization_id=p_org for update;
 if not found then raise exception 'PLAN_NOT_FOUND: project not found' using errcode='P0002'; end if;
 if project_row.assigned_developer_id is distinct from p_developer then
  raise exception 'PLAN_FORBIDDEN: project assignment required' using errcode='42501'; end if;
 if project_row.task_plan_status='pending' then
  return jsonb_build_object('success',true,'message','Task plan already submitted','project',to_jsonb(project_row)); end if;
 if coalesce(project_row.task_plan_status,'draft') not in ('draft','rejected','') then
  raise exception 'PLAN_CONFLICT: task plan cannot be resubmitted'; end if;
 -- Lock every matching saved row until submission commits. No DELETE/replacement
 -- occurs, so assignments, checklist links, and existing task IDs remain intact.
 perform id from public.developer_tasks where project_id=p_project and organization_id=p_org and developer_id=p_developer for share;
 if not found then raise exception 'PLAN_INVALID: no saved tasks' using errcode='22023'; end if;
 if exists(select 1 from public.developer_tasks where project_id=p_project and organization_id=p_org and developer_id=p_developer
   and (nullif(btrim(task_title),'') is null or start_date is null or end_date is null or end_date<start_date)) then
  raise exception 'PLAN_INVALID: saved tasks require titles and valid date ranges' using errcode='22023'; end if;
 update public.projects set task_plan_submitted=true,task_plan_status='pending',task_plan_submitted_at=now(),
  task_plan_reviewed_at=null,task_plan_reviewed_by=null,task_plan_rejection_reason=null
  where id=p_project and organization_id=p_org returning * into project_row;
 return jsonb_build_object('success',true,'message','Task plan submitted successfully','project',to_jsonb(project_row));
end $$;
revoke all on function public.submit_existing_task_plan(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_existing_task_plan(uuid,uuid,uuid) to service_role;
commit;
