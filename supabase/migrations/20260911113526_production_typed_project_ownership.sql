begin;
alter table public.projects add column created_by_type text check(created_by_type in ('admin','developer')),
 add column added_by_type text check(added_by_type in ('admin','developer')),
 add column manager_type text check(manager_type in ('admin','developer'));
create or replace function public.project_unique_identity_type(p_org uuid,p_reference text)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
 select min(m.user_type) from public.memberships m where m.organization_id=p_org and m.user_id::text=p_reference
  and m.user_type in ('admin','developer') having count(distinct m.user_type)=1;
$$;
revoke all on function public.project_unique_identity_type(uuid,text) from public,anon,authenticated;
grant execute on function public.project_unique_identity_type(uuid,text) to service_role;
update public.projects set created_by_type=public.project_unique_identity_type(organization_id,created_by::text),
 added_by_type=public.project_unique_identity_type(organization_id,added_by::text),
 manager_type=public.project_unique_identity_type(organization_id,manager_id::text);

create or replace function public.project_actor_is_owner(p_org uuid,p_project uuid,p_user uuid,p_type text,p_allow_legacy boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_type in ('admin','developer') and exists(select 1 from public.memberships m where m.organization_id=p_org
  and m.user_id=p_user and m.user_type=p_type and m.status='active') and exists(
  select 1 from public.projects p where p.id=p_project and p.organization_id=p_org and (
   (p.created_by::text=p_user::text and coalesce(p.created_by_type,public.project_unique_identity_type(p_org,p.created_by::text))=p_type)
   or (p.added_by::text=p_user::text and coalesce(p.added_by_type,public.project_unique_identity_type(p_org,p.added_by::text))=p_type)
   or (p_allow_legacy and (
    (to_jsonb(p)->>'admin_id'=p_user::text and public.project_unique_identity_type(p_org,to_jsonb(p)->>'admin_id')=p_type)
    or exists(select 1 from public.memberships legacy where legacy.organization_id=p_org and legacy.user_id=p_user and legacy.user_type=p_type
      and nullif(lower(btrim(to_jsonb(p)->>'added_by_admin')),'')=lower(btrim(legacy.email))
      and (select count(*) from public.memberships matches where matches.organization_id=p_org and matches.user_type in ('admin','developer')
        and lower(btrim(matches.email))=lower(btrim(legacy.email)))=1)))));
$$;
revoke all on function public.project_actor_is_owner(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.project_actor_is_owner(uuid,uuid,uuid,text,boolean) to service_role;
create or replace function public.project_actor_is_manager(p_org uuid,p_project uuid,p_user uuid,p_type text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_type in ('admin','developer') and exists(select 1 from public.memberships m where m.organization_id=p_org
  and m.user_id=p_user and m.user_type=p_type and m.status='active') and exists(select 1 from public.projects p
   where p.id=p_project and p.organization_id=p_org and p.manager_id::text=p_user::text
    and coalesce(p.manager_type,public.project_unique_identity_type(p_org,p.manager_id::text))=p_type);
$$;
revoke all on function public.project_actor_is_manager(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.project_actor_is_manager(uuid,uuid,uuid,text) to service_role;

-- Delegation is scoped to the project's verified manager, assigned through the
-- protected manager workflow. It does not confer task.review or waive self-review.
create or replace function public.project_actor_can_review(p_org uuid,p_project uuid,p_user uuid,p_type text,p_allow_legacy boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.project_actor_is_owner(p_org,p_project,p_user,p_type,p_allow_legacy)
   or public.project_actor_is_manager(p_org,p_project,p_user,p_type);
$$;
revoke all on function public.project_actor_can_review(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.project_actor_can_review(uuid,uuid,uuid,text,boolean) to service_role;

create or replace function public.guard_project_typed_attribution()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare profile_type text; member_row public.memberships%rowtype; manager_profile text;
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 profile_type:=auth.jwt()->'app_metadata'->>'user_type';
 select * into member_row from public.memberships where organization_id=public.auth_org() and user_id=public.auth_app_user_id()
  and user_type=profile_type and status='active' and user_type in ('admin','developer');
 if not found or new.organization_id is distinct from public.auth_org() then
  raise exception 'Project attribution requires active staff identity' using errcode='42501'; end if;
 if tg_op='UPDATE' then
  if row(new.created_by_type,new.added_by_type,new.manager_type) is distinct from row(old.created_by_type,old.added_by_type,old.manager_type)
    or to_jsonb(new)->'admin_id' is distinct from to_jsonb(old)->'admin_id' then
   raise exception 'Project ownership types require the server workflow' using errcode='42501'; end if;
  return new;
 end if;
 -- Includes invoker clone_project: a clone's creator is the cloner. Source
 -- provenance remains in its clone activity record, not in ownership fields.
 new.created_by:=member_row.user_id; new.created_by_type:=profile_type;
 new.added_by:=member_row.user_id; new.added_by_type:=profile_type;
 new.added_by_admin:=member_row.email;
 -- Optional legacy column is an alternate owner path, not arbitrary metadata.
 new:=jsonb_populate_record(new,jsonb_build_object('admin_id',null));
 if new.manager_id is null then new.manager_type:=null;
 else
  if not coalesce(public.auth_override('project.assign_manager'),member_row.role in ('owner','admin'),false) then
   raise exception 'Project manager assignment permission required' using errcode='42501'; end if;
  if new.manager_type is null then
   select min(m.user_type) into manager_profile from public.memberships m where m.organization_id=new.organization_id
    and m.user_id=new.manager_id and m.user_type in ('admin','developer') having count(distinct m.user_type)=1;
   new.manager_type:=manager_profile;
  end if;
  if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=new.manager_id
   and m.user_type=new.manager_type and m.status='active' and m.role in ('owner','admin','manager','team_lead')) then
   raise exception 'Project manager must be an unambiguous active eligible staff identity' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_project_typed_attribution() from public;
create trigger project_typed_attribution before insert or update on public.projects for each row execute function public.guard_project_typed_attribution();

create or replace function public.commit_task_review(p_org uuid,p_reviewer uuid,p_profile_type text,p_email text,
  p_task uuid,p_submission uuid,p_action text,p_comments text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare member_row public.memberships%rowtype; task_row public.developer_tasks%rowtype;
  submission_row public.task_submissions%rowtype; project_row public.projects%rowtype;
  reviewed_time timestamptz:=now(); on_time boolean; score int; outcome text; totals record; percentage numeric;
begin
  if p_action not in ('approve','reject') or p_action is null or (p_action='reject' and nullif(btrim(p_reason),'') is null) then
    raise exception 'REVIEW_INVALID: action and rejection reason are required' using errcode='22023';
  end if;
  if p_profile_type not in ('admin','developer') or p_profile_type is null then
    raise exception 'REVIEW_FORBIDDEN: staff profile required' using errcode='42501';
  end if;
  perform app_private.lock_quota(p_org);
  select * into member_row from public.memberships where organization_id=p_org and user_id=p_reviewer
    and user_type=p_profile_type and status='active' for share;
  if not found or not coalesce((select allowed from public.user_permissions where membership_id=member_row.id
    and permission_key='task.review'),member_row.role in ('owner','admin','manager','team_lead','qa'),false) then
    raise exception 'REVIEW_FORBIDDEN: reviewer permission required' using errcode='42501';
  end if;
  if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
  select * into task_row from public.developer_tasks where id=p_task and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: task not found' using errcode='P0002'; end if;
  select * into project_row from public.projects where id=task_row.project_id and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: project not found' using errcode='P0002'; end if;
  if not public.project_actor_can_review(p_org,task_row.project_id,p_reviewer,p_profile_type,false) then
    raise exception 'REVIEW_FORBIDDEN: project ownership or assigned manager authority required' using errcode='42501';
  end if;
  select * into submission_row from public.task_submissions where id=p_submission and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: submission not found' using errcode='P0002'; end if;
  if submission_row.task_id is distinct from p_task then raise exception 'REVIEW_INVALID: mismatched task' using errcode='22023'; end if;
  if p_profile_type='developer' and (p_reviewer=task_row.developer_id or p_reviewer=submission_row.developer_id) then
    raise exception 'REVIEW_FORBIDDEN: cannot review your own work' using errcode='42501';
  end if;
  -- Reassignment/project moves can happen after proof was submitted. Never
  -- award the current assignee points for another person's or project's proof.
  if submission_row.developer_id is distinct from task_row.developer_id
    or submission_row.project_id is distinct from task_row.project_id then
    raise exception 'REVIEW_CONFLICT: submission no longer matches task assignment or project';
  end if;
  if task_row.status in ('completed','rejected') or submission_row.review_status is distinct from 'pending' or coalesce(submission_row.is_reviewed,false) then
    raise exception 'REVIEW_CONFLICT: work has already been reviewed';
  end if;
  if task_row.end_date is null or submission_row.submitted_at is null then
    raise exception 'REVIEW_INVALID: deadline and submission time are required' using errcode='22023';
  end if;
  on_time := (submission_row.submitted_at at time zone 'UTC')::date <= task_row.end_date::date;
  outcome := case when p_action='approve' then 'completed' else 'rejected' end;
  score := case when p_action='reject' then 0 when on_time then 1 else -1 end;
  update public.developer_tasks set status=outcome,is_on_time=case when p_action='approve' then on_time else null end,
    productivity_points=score,actual_completion_date=case when p_action='approve' then (reviewed_time at time zone 'UTC')::date else null end,
    reviewed_by=p_reviewer,reviewed_at=reviewed_time,admin_comments=p_comments,
    rejection_reason=case when p_action='reject' then p_reason else null end,updated_at=reviewed_time where id=p_task;
  update public.task_submissions set is_reviewed=true,reviewed_by=p_reviewer,reviewed_at=reviewed_time,
    review_status=case when p_action='approve' then 'approved' else 'rejected' end,
    review_comments=case when p_action='approve' then p_comments else p_reason end where id=p_submission;
  insert into public.admin_reviews(organization_id,admin_id,admin_email,admin_name,task_id,submission_id,project_id,developer_id,
    review_action,review_comments,rejection_reason,task_title,submission_file_url,deadline,submission_date,reviewed_at)
  values(p_org,p_reviewer,p_email,p_email,p_task,p_submission,task_row.project_id,task_row.developer_id,
    case when p_action='approve' then 'approved' else 'rejected' end,p_comments,p_reason,task_row.task_title,
    submission_row.file_url,task_row.end_date,submission_row.submitted_at,reviewed_time);
  insert into public.activity_logs(organization_id,developer_id,project_id,task_id,action_type,action_description,old_value,new_value)
  values(p_org,task_row.developer_id,task_row.project_id,p_task,
    case when p_action='approve' then 'task_approved' else 'task_rejected' end,
    format('Task "%s" %s by reviewer',task_row.task_title,outcome),task_row.status,outcome);
  select count(*) total,count(*) filter(where status='completed' and is_on_time=true) timely,
    count(*) filter(where status='completed' and is_on_time=false) late,
    count(*) filter(where status in ('pending','in_progress','awaiting_approval')) pending,
    count(*) filter(where status='rejected') rejected into totals
    from public.developer_tasks where organization_id=p_org and project_id=task_row.project_id and developer_id=task_row.developer_id;
  percentage:=round(greatest(0,least(100,(totals.timely-totals.late+totals.pending*0.5)*100/nullif(totals.total,0))),2);
  insert into public.productivity_metrics(organization_id,developer_id,project_id,total_tasks,completed_on_time,completed_late,
    pending_tasks,rejected_tasks,productivity_percentage,productivity_points,updated_at)
  values(p_org,task_row.developer_id,task_row.project_id,totals.total,totals.timely,totals.late,totals.pending,totals.rejected,
    percentage,totals.timely-totals.late,reviewed_time)
  on conflict(developer_id,project_id) do update set organization_id=excluded.organization_id,total_tasks=excluded.total_tasks,
    completed_on_time=excluded.completed_on_time,completed_late=excluded.completed_late,pending_tasks=excluded.pending_tasks,
    rejected_tasks=excluded.rejected_tasks,productivity_percentage=excluded.productivity_percentage,
    productivity_points=excluded.productivity_points,updated_at=excluded.updated_at;
  -- Project totals include every assignee, not just the person reviewed last.
  select count(*) total,count(*) filter(where status='completed' and is_on_time=true) timely,
    count(*) filter(where status='completed' and is_on_time=false) late,
    count(*) filter(where status in ('pending','in_progress','awaiting_approval')) pending into totals
    from public.developer_tasks where organization_id=p_org and project_id=task_row.project_id;
  update public.projects set total_tasks_count=totals.total,completed_tasks_count=totals.timely+totals.late,
    total_productivity_score=round(greatest(0,least(100,(totals.timely-totals.late+totals.pending*0.5)*100/nullif(totals.total,0))),2),
    progress=round((totals.timely+totals.late)*100.0/nullif(totals.total,0)),updated_at=reviewed_time where id=task_row.project_id;
  insert into public.notifications(organization_id,developer_id,admin_id,admin_recipient_type,type,title,message,project_id,task_id,submission_id,read)
  values(p_org,task_row.developer_id,p_reviewer,p_profile_type,
    case when p_action='approve' then 'task_approved' else 'task_rejected' end,
    case when p_action='approve' then 'Task Approved' else 'Task Rejected' end,
    case when p_action='approve' then format('Your task "%s" has been approved! %s',task_row.task_title,
      case when on_time then '(Completed on time - +1 point)' else '(Completed late - -1 point)' end)
      else format('Your task "%s" was rejected. Reason: %s',task_row.task_title,p_reason) end,
    task_row.project_id,p_task,p_submission,false);
  return jsonb_build_object('success',true,'message',format('Task %s successfully',outcome),
    'task',jsonb_build_object('id',p_task,'status',outcome,'is_on_time',on_time,'productivity_points',score));
end;
$$;
revoke all on function public.commit_task_review(uuid,uuid,text,text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.commit_task_review(uuid,uuid,text,text,uuid,uuid,text,text,text) to service_role;

create or replace function public.task_watcher_reviewer_eligible(p_org uuid,p_task uuid,p_user uuid,p_type text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_type in ('admin','developer') and exists(
  select 1 from public.memberships m join public.developer_tasks t on t.id=p_task and t.organization_id=m.organization_id
   join public.projects p on p.id=t.project_id and p.organization_id=m.organization_id
  where m.organization_id=p_org and m.user_id=p_user and m.user_type=p_type and m.status='active'
   and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),
     m.role in ('owner','admin','manager','team_lead','qa'),false)
   and public.project_actor_can_review(p_org,p.id,p_user,p_type,false)
   and (p_type<>'developer' or t.developer_id is distinct from p_user)
   and not exists(select 1 from public.task_submissions s where s.organization_id=p_org and s.task_id=p_task
     and s.review_status='pending' and s.developer_id=p_user and p_type='developer')
);
$$;
revoke all on function public.task_watcher_reviewer_eligible(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.task_watcher_reviewer_eligible(uuid,uuid,uuid,text) to service_role;


create or replace function public.clone_project(p_source uuid,p_name text,p_copy_tasks boolean default true)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare source_project public.projects%rowtype; cloned_project public.projects%rowtype; cloned_task public.developer_tasks%rowtype;
 source_tasks jsonb:='[]'; task_ids jsonb:='{}'; item record; payload jsonb; parent_id text; cloned_count int:=0;
 clone_id uuid:=gen_random_uuid(); org uuid:=public.auth_org(); today date:=(now() at time zone 'UTC')::date;
begin
 if org is null or not coalesce(public.auth_project_mutation('project.create'),false) then
   raise exception 'CLONE_FORBIDDEN: project creation permission required' using errcode='42501'; end if;
 if not public.auth_org_unlocked() then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 -- Capture source configuration and visible tasks in one statement snapshot.
 -- FOR SHARE would also require the source project UPDATE policy (project.hub),
 -- accidentally denying an otherwise valid create grant plus read access.
 select to_jsonb(p) project,case when coalesce(p_copy_tasks,true) then
   (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.developer_tasks t
     where t.project_id=p.id and t.organization_id=org) else '[]'::jsonb end tasks
   into item from public.projects p where p.id=p_source and p.organization_id=org;
 if not found then raise exception 'CLONE_NOT_FOUND: source project not found' using errcode='P0002'; end if;
 source_project:=jsonb_populate_record(null::public.projects,item.project);
 source_tasks:=item.tasks;
 if coalesce(p_copy_tasks,true) then
   for item in select value from jsonb_array_elements(source_tasks) loop
     task_ids:=task_ids||jsonb_build_object(item.value->>'id',gen_random_uuid());
   end loop;
 end if;
 payload:=to_jsonb(source_project)-array['id','created_at','updated_at','name','status','progress',
   'total_tasks_count','completed_tasks_count','total_productivity_score','task_plan_submitted','task_plan_status',
   'task_plan_submitted_at','task_plan_reviewed_at','task_plan_reviewed_by','task_plan_rejection_reason',
   'completed_at','completed_by','client_signed_off_at','client_rating','client_feedback','closed_at','closed_by','closure_note'];
 payload:=payload||jsonb_build_object('id',clone_id,'organization_id',org,'name',coalesce(nullif(btrim(p_name),''),source_project.name||' (copy)'),
   'status','pending','progress',0,'total_tasks_count',0,'completed_tasks_count',0,'total_productivity_score',0,
   'task_plan_submitted',false,'task_plan_status','draft','is_template',false,'archived',false,'created_at',now(),'updated_at',now());
 -- A creator without manager-assignment authority cannot carry that authority
 -- into a new project through the generic source configuration copy.
 if not coalesce(public.auth_override('project.assign_manager'),public.auth_role() in ('owner','admin'),false) then
  payload:=payload||jsonb_build_object('manager_id',null,'manager_type',null);
 end if;
 cloned_project:=jsonb_populate_record(null::public.projects,payload);
 insert into public.projects select cloned_project.* returning * into cloned_project;
 -- Parents first. A parent outside the caller's copied snapshot is detached;
 -- it must never remain an edge back into the original or an invisible project.
 for item in
   with recursive source as (select value,value->>'id' id,value->>'parent_task_id' parent from jsonb_array_elements(source_tasks)),
   tree as (
     select s.value,s.id,0 depth from source s where s.parent is null or not task_ids?s.parent
     union all
     select child.value,child.id,tree.depth+1 from source child join tree on child.parent=tree.id
   ) select value from tree order by depth,id
 loop
   payload:=item.value-array['id','created_at','updated_at','submitted_at','reviewed_at','reviewed_by',
     'actual_completion_date','admin_comments','rejection_reason','is_on_time','productivity_points'];
   parent_id:=item.value->>'parent_task_id';
   payload:=payload||jsonb_build_object('id',task_ids->>(item.value->>'id'),'organization_id',org,'project_id',clone_id,
     'parent_task_id',task_ids->>parent_id,'status','pending','client_visible',false,'productivity_points',0,
     'start_date',coalesce(item.value->>'start_date',today::text),'end_date',coalesce(item.value->>'end_date',today::text),
     'created_at',now(),'updated_at',now());
   -- This feature clones projects and tasks, not their sprint/epic containers.
   -- Organization-wide open containers remain usable; project-owned or closed
   -- containers are deliberately detached from the new project.
   if not exists(select 1 from public.sprints where id=(payload->>'sprint_id')::uuid and organization_id=org
      and project_id is null and status is distinct from 'completed') then payload:=payload||'{"sprint_id":null}'; end if;
   if not exists(select 1 from public.epics where id=(payload->>'epic_id')::uuid and organization_id=org
      and project_id is null) then payload:=payload||'{"epic_id":null}'; end if;
   cloned_task:=jsonb_populate_record(null::public.developer_tasks,payload);
   insert into public.developer_tasks select cloned_task.*;
   cloned_count:=cloned_count+1;
 end loop;
 if cloned_count<>jsonb_array_length(source_tasks) then raise exception 'CLONE_INVALID: source task hierarchy contains a cycle' using errcode='22023'; end if;
 return jsonb_build_object('project',to_jsonb(cloned_project),'tasks',cloned_count);
end $$;
revoke all on function public.clone_project(uuid,text,boolean) from public,anon;
grant execute on function public.clone_project(uuid,text,boolean) to authenticated;

commit;
