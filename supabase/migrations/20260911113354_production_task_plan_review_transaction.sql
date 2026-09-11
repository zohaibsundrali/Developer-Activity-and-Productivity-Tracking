begin;
-- Requires the typed project ownership foundation installed in this release.
-- Helper references in this PL/pgSQL body resolve when the RPC is called.
create or replace function public.commit_task_plan_review(p_org uuid,p_project uuid,p_reviewer uuid,p_type text,p_action text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare member_row public.memberships%rowtype; recipient public.memberships%rowtype;
 project_row public.projects%rowtype; outcome text; notice_count int:=0;
begin
 if p_type is null or p_type not in ('admin','developer') then
   raise exception 'PLAN_REVIEW_FORBIDDEN: staff profile required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('approve','reject') or (p_action='reject' and nullif(btrim(p_reason),'') is null) then
   raise exception 'PLAN_REVIEW_INVALID: valid action and rejection reason required' using errcode='22023'; end if;
 perform app_private.lock_quota(p_org);
 select * into member_row from public.memberships where organization_id=p_org and user_id=p_reviewer
   and user_type=p_type and status='active' for share;
 if not found or not coalesce((select allowed from public.user_permissions where membership_id=member_row.id and permission_key='task.review'),
   member_row.role in ('owner','admin','manager','team_lead','qa'),false) then
   raise exception 'PLAN_REVIEW_FORBIDDEN: reviewer permission required' using errcode='42501'; end if;
 if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 select * into project_row from public.projects where id=p_project and organization_id=p_org for update;
 if not found then raise exception 'PLAN_REVIEW_NOT_FOUND: project not found' using errcode='P0002'; end if;
 if not public.project_actor_can_review(p_org,p_project,p_reviewer,p_type,true) then
   raise exception 'PLAN_REVIEW_FORBIDDEN: project ownership or assigned manager required' using errcode='42501'; end if;
 if p_type='developer' and project_row.assigned_developer_id=p_reviewer then
   raise exception 'PLAN_REVIEW_FORBIDDEN: cannot review your own task plan' using errcode='42501'; end if;
 if not coalesce(project_row.task_plan_submitted,false) or project_row.task_plan_status is distinct from 'pending' then
   raise exception 'PLAN_REVIEW_CONFLICT: task plan is not awaiting review'; end if;
 if p_action='approve' then
   perform id from public.developer_tasks where organization_id=p_org and project_id=p_project
     and developer_id=project_row.assigned_developer_id for share;
   if not found then raise exception 'PLAN_REVIEW_INVALID: no saved tasks to approve' using errcode='22023'; end if;
   if exists(select 1 from public.developer_tasks where organization_id=p_org and project_id=p_project
     and developer_id=project_row.assigned_developer_id and (nullif(btrim(task_title),'') is null
       or start_date is null or end_date is null or end_date<start_date)) then
     raise exception 'PLAN_REVIEW_INVALID: saved tasks require titles and valid date ranges' using errcode='22023';
   end if;
 end if;
 outcome:=case when p_action='approve' then 'approved' else 'rejected' end;
 update public.projects set task_plan_status=outcome,task_plan_reviewed_at=now(),task_plan_reviewed_by=p_reviewer,
   task_plan_rejection_reason=case when p_action='reject' then btrim(p_reason) else null end
   where id=p_project returning * into project_row;
 -- Only the active assignee with effective project access receives the verdict.
 -- A suspended or permission-denied assignee does not prevent administration.
 select * into recipient from public.memberships where organization_id=p_org and user_id=project_row.assigned_developer_id
   and user_type='developer' and status='active';
 if found and (
   coalesce((select allowed from public.user_permissions where membership_id=recipient.id and permission_key='project.view_own'),
     recipient.role in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee'),false)
   or coalesce((select allowed from public.user_permissions where membership_id=recipient.id and permission_key='project.view_all'),
     recipient.role in ('owner','admin','manager','team_lead'),false)) then
   insert into public.notifications(organization_id,developer_id,type,category,title,message,project_id,entity_type,entity_id,actor_id,metadata,read)
   values(p_org,recipient.user_id,'task_plan_'||outcome,'review','Task plan '||outcome,
     'Your task plan has been '||outcome||'. Open the project to view the review.',p_project,'project',p_project,p_reviewer,
     jsonb_build_object('actorType',p_type,'planStatus',outcome),false);
   get diagnostics notice_count=row_count;
 end if;
 return jsonb_build_object('success',true,'message','Task plan '||outcome||' successfully','project',to_jsonb(project_row),'notifications',notice_count);
end $$;
revoke all on function public.commit_task_plan_review(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.commit_task_plan_review(uuid,uuid,uuid,text,text,text) to service_role;
commit;
