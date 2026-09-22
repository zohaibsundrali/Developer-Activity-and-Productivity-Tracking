-- Preserve developer foreign keys and represent admin profiles separately.
begin;
alter table public.developer_tasks add column assignee_admin_id uuid references public.admin_users(id) on delete set null;
alter table public.developer_tasks add constraint task_single_assignee check (num_nonnulls(developer_id,assignee_admin_id)<=1);
alter table public.task_submissions add column assignee_admin_id uuid references public.admin_users(id) on delete restrict;
alter table public.task_submissions add constraint submission_single_assignee check (num_nonnulls(developer_id,assignee_admin_id)<=1);
alter table public.activity_logs add column assignee_admin_id uuid references public.admin_users(id) on delete set null;
alter table public.admin_reviews add column assignee_admin_id uuid references public.admin_users(id) on delete set null;
create index task_admin_assignment on public.developer_tasks(assignee_admin_id,organization_id,id) where assignee_admin_id is not null;
create index task_developer_assignment on public.developer_tasks(organization_id,developer_id,id) where developer_id is not null;
create index submission_admin_assignment on public.task_submissions(assignee_admin_id) where assignee_admin_id is not null;
create index activity_admin_assignment on public.activity_logs(assignee_admin_id) where assignee_admin_id is not null;
create index review_admin_assignment on public.admin_reviews(assignee_admin_id) where assignee_admin_id is not null;

create or replace function public.task_assigned_to(p_developer uuid,p_admin uuid,p_user uuid,p_type text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(case p_type when 'admin' then p_admin=p_user and p_developer is null
 when 'developer' then p_developer=p_user and p_admin is null else false end,false);
$$;
revoke all on function public.task_assigned_to(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.task_assigned_to(uuid,uuid,uuid,text) to authenticated,service_role;


CREATE OR REPLACE FUNCTION public.auth_task_access(p_org uuid, p_project uuid, p_developer uuid, p_kind text, p_visible boolean, p_action text, p_admin uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare own_task boolean; begin
  if p_org is distinct from public.auth_org() or public.auth_org() is null then return false; end if;
  if public.auth_is_client() then
    return p_action='read' and coalesce(p_visible,false) and public.auth_plan_feature('client_portal')
      and p_project in (select public.auth_client_project_ids());
  end if;
  own_task:=public.task_assigned_to(p_developer,p_admin,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type');
  if p_action='read' then return public.auth_task_capability('task.view_all') or public.auth_task_capability('task.review')
    or (coalesce(own_task,false) and public.auth_task_capability('task.view_own'))
    or (p_kind='bug' and public.auth_task_capability('bug.triage')); end if;
  if public.auth_task_capability('task.manage') then return p_action in ('insert','update','delete'); end if;
  if p_action='insert' then return p_kind='bug' and public.auth_task_capability('bug.raise'); end if;
  if p_action='update' then return (public.auth_task_capability('task.set_client_visibility')
      and public.auth_task_access(p_org,p_project,p_developer,p_kind,p_visible,'read',p_admin)) or (coalesce(own_task,false) and public.auth_task_capability('task.update_own'))
    or (p_kind='bug' and public.auth_task_capability('bug.triage')); end if;
  if p_action='delete' then return coalesce(own_task,false) and public.auth_task_plan_edit(p_project); end if;
  return false;
end $function$
;


revoke all on function public.auth_task_access(uuid,uuid,uuid,text,boolean,text,uuid) from public,anon;
grant execute on function public.auth_task_access(uuid,uuid,uuid,text,boolean,text,uuid) to authenticated,service_role;
-- Keep the six-argument API for existing developer-only integrations.


alter policy task_authority_read on public.developer_tasks using (public.auth_task_access(organization_id,project_id,developer_id,task_type,client_visible,'read',assignee_admin_id));

alter policy task_authority_insert on public.developer_tasks  with check (public.auth_task_access(organization_id,project_id,developer_id,task_type,client_visible,'insert',assignee_admin_id));

alter policy task_authority_update on public.developer_tasks using (public.auth_task_access(organization_id,project_id,developer_id,task_type,client_visible,'update',assignee_admin_id)) with check (public.auth_task_access(organization_id,project_id,developer_id,task_type,client_visible,'update',assignee_admin_id));

alter policy task_authority_delete on public.developer_tasks using (public.auth_task_access(organization_id,project_id,developer_id,task_type,client_visible,'delete',assignee_admin_id));

CREATE OR REPLACE FUNCTION public.guard_task_authority_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    if not manager and (new.task_type is distinct from 'bug' or (new.developer_id is not null or new.assignee_admin_id is not null)
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
  own_task:=public.task_assigned_to(old.developer_id,old.assignee_admin_id,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type')
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
end $function$
;


-- Validate every assignment, including service integrations. Row locks serialize
-- assignment changes with the submission/review transactions.
create or replace function public.guard_typed_task_assignee() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare assignee uuid; kind text;
begin
 if tg_op='UPDATE' then
  if new.developer_id is not distinct from old.developer_id and new.assignee_admin_id is not distinct from old.assignee_admin_id
   and new.organization_id is not distinct from old.organization_id then return new; end if;
  if old.status='completed' then raise exception 'Approved task assignments are immutable' using errcode='42501'; end if;
 end if;
 if new.developer_id is not null and new.assignee_admin_id is not null then
  raise exception 'A task can have only one assignee' using errcode='23514'; end if;
 assignee:=coalesce(new.developer_id,new.assignee_admin_id);
 kind:=case when new.assignee_admin_id is not null then 'admin' else 'developer' end;
 if assignee is not null and not exists(select 1 from public.memberships m
  where m.organization_id=new.organization_id and m.user_id=assignee and m.user_type=kind
    and m.status='active' and m.role<>'client') then
  raise exception 'Task assignee must be active staff in this organization' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_typed_task_assignee() from public,anon,authenticated;
create trigger typed_task_assignee before insert or update of developer_id,assignee_admin_id,organization_id
 on public.developer_tasks for each row execute function public.guard_typed_task_assignee();


CREATE OR REPLACE FUNCTION public.notification_task_recipient_allowed(p_org uuid, p_task uuid, p_user uuid, p_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select p_org=public.auth_org() and p_type in ('admin','developer') and exists(
 select 1 from public.developer_tasks t join public.memberships m on m.organization_id=t.organization_id
 where t.id=p_task and t.organization_id=p_org and m.user_id=p_user and m.user_type=p_type and m.status='active' and m.role<>'client'
 and public.auth_task_access(t.organization_id,t.project_id,t.developer_id,t.task_type,t.client_visible,'read',t.assignee_admin_id)
 and (
  coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_all'),m.role in ('owner','admin','manager','team_lead'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),m.role in ('owner','admin','manager','team_lead','qa'),false)
  or (public.task_assigned_to(t.developer_id,t.assignee_admin_id,p_user,p_type) and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_own'),
    m.role in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee'),false))
  or (t.task_type='bug' and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='bug.triage'),m.role in ('owner','admin','manager','team_lead','qa'),false))
  ));
$function$
;


CREATE OR REPLACE FUNCTION public.task_watcher_reviewer_eligible(p_org uuid, p_task uuid, p_user uuid, p_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select p_type in ('admin','developer') and exists(
  select 1 from public.memberships m join public.developer_tasks t on t.id=p_task and t.organization_id=m.organization_id
   join public.projects p on p.id=t.project_id and p.organization_id=m.organization_id
  where m.organization_id=p_org and m.user_id=p_user and m.user_type=p_type and m.status='active'
   and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),
     m.role in ('owner','admin','manager','team_lead','qa'),false)
   and public.project_actor_can_review(p_org,p.id,p_user,p_type,false)
   and not public.task_assigned_to(t.developer_id,t.assignee_admin_id,p_user,p_type)
   and not exists(select 1 from public.task_submissions s where s.organization_id=p_org and s.task_id=p_task
     and s.review_status='pending' and public.task_assigned_to(s.developer_id,s.assignee_admin_id,p_user,p_type))
);
$function$
;


CREATE OR REPLACE FUNCTION private.assignment_notice_recipient(p_org uuid, p_user uuid, p_kind text, p_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=p_user
  and m.user_type=p_type and p_type in ('admin','developer') and m.status='active' and m.role<>'client' and (
  coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_own'),m.role in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_all'),m.role in ('owner','admin','manager','team_lead'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),m.role in ('owner','admin','manager','team_lead','qa'),false)
  or (p_kind='bug' and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='bug.triage'),m.role in ('owner','admin','manager','team_lead','qa'),false))));
$function$
;


revoke all on function private.assignment_notice_recipient(uuid,uuid,text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_task_assignment_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare previous_id uuid; previous_type text; next_id uuid; next_type text; actor uuid; actor_profile text; previous_title text; event_type text;
begin
 next_id:=coalesce(new.developer_id,new.assignee_admin_id);
 next_type:=case when new.assignee_admin_id is not null then 'admin' else 'developer' end;
 if tg_op='UPDATE' then
  if new.developer_id is not distinct from old.developer_id and new.assignee_admin_id is not distinct from old.assignee_admin_id then return new; end if;
  previous_id:=coalesce(old.developer_id,old.assignee_admin_id);
  previous_type:=case when old.assignee_admin_id is not null then 'admin' else 'developer' end;
  update public.task_submissions set review_status='superseded' where task_id=new.id and organization_id=new.organization_id and review_status='pending';
  if new.status in ('awaiting_approval','reviewed') then
   update public.developer_tasks set status='pending',submitted_at=null,updated_at=now() where id=new.id;
  end if;
  previous_title:=coalesce(nullif(old.task_title,''),'A task');
 end if;
 actor:=public.auth_app_user_id(); actor_profile:=auth.jwt()->'app_metadata'->>'user_type';
 if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=actor
  and m.user_type=actor_profile and m.user_type in ('admin','developer') and m.status='active' and m.role<>'client') then
  actor:=null; actor_profile:=null;
 end if;
 if next_id is not null and private.assignment_notice_recipient(new.organization_id,next_id,new.task_type,next_type)
  and not coalesce(actor_profile=next_type and actor=next_id,false) then
  event_type:=case when previous_id is null then 'task_assigned' else 'task_reassigned' end;
  insert into public.notifications(organization_id,developer_id,admin_id,admin_recipient_type,type,category,title,message,task_id,project_id,actor_id,actor_type,metadata,read)
  values(new.organization_id,new.developer_id,new.assignee_admin_id,'admin',event_type,'assignment','Task assigned to you',
   format('You have been assigned "%s".',coalesce(nullif(new.task_title,''),'a task')),new.id,new.project_id,actor,actor_profile,
   jsonb_build_object('taskTitle',new.task_title),false);
 end if;
 if previous_id is not null and private.assignment_notice_recipient(old.organization_id,previous_id,old.task_type,previous_type)
  and not coalesce(actor_profile=previous_type and actor=previous_id,false) then
  -- The old assignee may lose parent access immediately. Keep only their OLD
  -- title snapshot; no current task/project link or successor identity leaks.
  event_type:=case when next_id is null then 'task_unassigned' else 'task_reassigned_away' end;
  insert into public.notifications(organization_id,developer_id,admin_id,admin_recipient_type,type,category,title,message,actor_id,actor_type,metadata,read)
  values(old.organization_id,old.developer_id,old.assignee_admin_id,'admin',event_type,'assignment','Task assignment removed',
   format('"%s" is no longer assigned to you.',previous_title),actor,actor_profile,jsonb_build_object('taskTitle',previous_title),false);
 end if;
 return new;
end $function$
;


drop trigger task_assignment_notification on public.developer_tasks;
create trigger task_assignment_notification after insert or update of developer_id,assignee_admin_id on public.developer_tasks
for each row execute function public.notify_task_assignment_transaction();

CREATE OR REPLACE FUNCTION public.commit_task_submission(p_org uuid, p_actor uuid, p_profile_type text, p_task uuid, p_project uuid, p_file_url text, p_file_name text, p_storage_path text, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare member_row public.memberships%rowtype; task_row public.developer_tasks%rowtype;
  project_row public.projects%rowtype; submission_row public.task_submissions%rowtype;
  metadata jsonb; own_assignment boolean; permission text; defaults boolean; prefix text;
  submitted_time timestamptz:=now(); pending_count int; description text; developer_name text;
begin
  select * into member_row from public.memberships where organization_id=p_org and user_id=p_actor
    and user_type=p_profile_type and status='active' and user_type in ('admin','developer');
  if not found then raise exception 'SUBMISSION_FORBIDDEN: active staff identity required' using errcode='42501'; end if;
  perform app_private.lock_quota(p_org);
  if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
  select * into task_row from public.developer_tasks where id=p_task and organization_id=p_org for update;
  if not found then raise exception 'SUBMISSION_NOT_FOUND: task not found' using errcode='P0002'; end if;
  if task_row.project_id is distinct from p_project then raise exception 'SUBMISSION_INVALID: project does not match task' using errcode='22023'; end if;
  if task_row.status='completed' or (task_row.developer_id is null and task_row.assignee_admin_id is null) then
    raise exception 'SUBMISSION_CONFLICT: completed or unassigned task cannot be submitted';
  end if;
  own_assignment:=public.task_assigned_to(task_row.developer_id,task_row.assignee_admin_id,p_actor,p_profile_type);
  permission:=case when own_assignment and (p_profile_type='developer' or not coalesce((select allowed from public.user_permissions where membership_id=member_row.id and permission_key='task.manage'),member_row.role in ('owner','admin','manager','team_lead'),false)) then 'task.submit' else 'task.manage' end;
  defaults:=case when permission='task.submit' then member_row.role in ('developer','designer','devops','qa','employee','team_lead')
    else member_row.role in ('owner','admin','manager','team_lead') end;
  if not coalesce((select allowed from public.user_permissions where membership_id=member_row.id and permission_key=permission),defaults,false) then
    raise exception 'SUBMISSION_FORBIDDEN: submit permission required' using errcode='42501';
  end if;
  select * into project_row from public.projects where id=p_project and organization_id=p_org;
  if not found then raise exception 'SUBMISSION_NOT_FOUND: project not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.memberships where organization_id=p_org and status='active'
    and public.task_assigned_to(task_row.developer_id,task_row.assignee_admin_id,user_id,user_type)) then
    raise exception 'SUBMISSION_INVALID: assignee is not active in organization' using errcode='22023'; end if;
  if task_row.assignee_admin_id is not null then
    select full_name into developer_name from public.admin_users where id=task_row.assignee_admin_id;
  else
    select name into developer_name from public.developers where id=task_row.developer_id;
  end if;
  if not found then raise exception 'SUBMISSION_INVALID: assignee does not belong to organization' using errcode='22023'; end if;
  prefix:=format('submissions/%s/%s/%s/',coalesce(task_row.developer_id,task_row.assignee_admin_id),p_project,p_task);
  if p_storage_path is null or left(p_storage_path,length(prefix))<>prefix or length(p_storage_path)<=length(prefix)
    or nullif(btrim(p_file_name),'') is null or nullif(p_file_url,'') is null then
    raise exception 'SUBMISSION_INVALID: uploaded proof must belong to this task' using errcode='22023';
  end if;
  select o.metadata into metadata from storage.objects o where bucket_id='task-submissions' and name=p_storage_path for share;
  if not found then raise exception 'SUBMISSION_INVALID: uploaded proof not found' using errcode='22023'; end if;
  select count(*) into pending_count from public.task_submissions where task_id=p_task and review_status='pending';
  if pending_count>1 then raise exception 'SUBMISSION_CONFLICT: multiple pending submissions require repair'; end if;
  if pending_count=1 then
    select * into submission_row from public.task_submissions where task_id=p_task and review_status='pending' for update;
    if submission_row.storage_path is distinct from p_storage_path or submission_row.developer_id is distinct from task_row.developer_id or submission_row.assignee_admin_id is distinct from task_row.assignee_admin_id then
      raise exception 'SUBMISSION_CONFLICT: task already has pending proof';
    end if;
    if task_row.status in ('awaiting_approval','reviewed') then
      return jsonb_build_object('success',true,'message','Task already submitted for review','submission',to_jsonb(submission_row),
        'isOnTime',(submission_row.submitted_at at time zone 'UTC')::date<=task_row.end_date);
    end if;
    submitted_time:=submission_row.submitted_at;
  else
    insert into public.task_submissions(organization_id,task_id,project_id,developer_id,assignee_admin_id,file_url,file_name,file_type,file_size,
      storage_path,submission_notes,submitted_at,is_reviewed,review_status)
    values(p_org,p_task,p_project,task_row.developer_id,task_row.assignee_admin_id,p_file_url,p_file_name,coalesce(metadata->>'mimetype','application/octet-stream'),
      app_private.object_bytes(metadata),p_storage_path,coalesce(p_notes,''),submitted_time,false,'pending') returning * into submission_row;
  end if;
  update public.developer_tasks set status='awaiting_approval',submitted_at=submitted_time,reviewed_by=null,reviewed_at=null,
    rejection_reason=null,admin_comments=null,updated_at=now() where id=p_task;
  description:=format('Task "%s" submitted for review%s%s',task_row.task_title,
    case when own_assignment then '' else ' on their behalf by a supervisor' end,
    case when task_row.status='rejected' and task_row.rejection_reason is not null then
      format(' (previous verdict cleared: rejected — %s)',task_row.rejection_reason) else '' end);
  insert into public.activity_logs(organization_id,developer_id,assignee_admin_id,project_id,task_id,action_type,action_description,old_value,new_value)
    values(p_org,task_row.developer_id,task_row.assignee_admin_id,p_project,p_task,'task_submitted',description,task_row.status,'awaiting_approval');
  insert into public.notifications(organization_id,admin_id,admin_recipient_type,type,title,message,project_id,task_id,submission_id,read)
    select p_org,m.user_id,m.user_type,'review_required','Task Submission for Review',
      format('%s has submitted "%s" for review in project "%s"',coalesce(developer_name,'Staff member'),task_row.task_title,project_row.name),
      p_project,p_task,submission_row.id,false
    from public.memberships m where m.organization_id=p_org and m.status='active'
      and public.task_watcher_reviewer_eligible(p_org,p_task,m.user_id,m.user_type);
  return jsonb_build_object('success',true,'message','Task submitted successfully for review','submission',to_jsonb(submission_row),
    'isOnTime',(submitted_time at time zone 'UTC')::date<=task_row.end_date);
end;
$function$
;


CREATE OR REPLACE FUNCTION public.commit_task_review(p_org uuid, p_reviewer uuid, p_profile_type text, p_email text, p_task uuid, p_submission uuid, p_action text, p_comments text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
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
  if public.task_assigned_to(task_row.developer_id,task_row.assignee_admin_id,p_reviewer,p_profile_type) or public.task_assigned_to(submission_row.developer_id,submission_row.assignee_admin_id,p_reviewer,p_profile_type) then
    raise exception 'REVIEW_FORBIDDEN: cannot review your own work' using errcode='42501';
  end if;
  -- Reassignment/project moves can happen after proof was submitted. Never
  -- award the current assignee points for another person's or project's proof.
  if submission_row.developer_id is distinct from task_row.developer_id
    or submission_row.assignee_admin_id is distinct from task_row.assignee_admin_id
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
  insert into public.admin_reviews(organization_id,admin_id,admin_email,admin_name,task_id,submission_id,project_id,developer_id,assignee_admin_id,
    review_action,review_comments,rejection_reason,task_title,submission_file_url,deadline,submission_date,reviewed_at)
  values(p_org,p_reviewer,p_email,p_email,p_task,p_submission,task_row.project_id,task_row.developer_id,task_row.assignee_admin_id,
    case when p_action='approve' then 'approved' else 'rejected' end,p_comments,p_reason,task_row.task_title,
    submission_row.file_url,task_row.end_date,submission_row.submitted_at,reviewed_time);
  insert into public.activity_logs(organization_id,developer_id,assignee_admin_id,project_id,task_id,action_type,action_description,old_value,new_value)
  values(p_org,task_row.developer_id,task_row.assignee_admin_id,task_row.project_id,p_task,
    case when p_action='approve' then 'task_approved' else 'task_rejected' end,
    format('Task "%s" %s by reviewer',task_row.task_title,outcome),task_row.status,outcome);
  -- Employee productivity metrics retain their existing developer-only contract.
  if task_row.developer_id is not null then
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
  end if;
  -- Project totals include every assignee, not just the person reviewed last.
  select count(*) total,count(*) filter(where status='completed' and is_on_time=true) timely,
    count(*) filter(where status='completed' and is_on_time=false) late,
    count(*) filter(where status in ('pending','in_progress','awaiting_approval')) pending into totals
    from public.developer_tasks where organization_id=p_org and project_id=task_row.project_id;
  update public.projects set total_tasks_count=totals.total,completed_tasks_count=totals.timely+totals.late,
    total_productivity_score=round(greatest(0,least(100,(totals.timely-totals.late+totals.pending*0.5)*100/nullif(totals.total,0))),2),
    progress=round((totals.timely+totals.late)*100.0/nullif(totals.total,0)),updated_at=reviewed_time where id=task_row.project_id;
  insert into public.notifications(organization_id,developer_id,admin_id,admin_recipient_type,type,title,message,project_id,task_id,submission_id,read)
  values(p_org,task_row.developer_id,coalesce(task_row.assignee_admin_id,p_reviewer),case when task_row.assignee_admin_id is not null then 'admin' else p_profile_type end,
    case when p_action='approve' then 'task_approved' else 'task_rejected' end,
    case when p_action='approve' then 'Task Approved' else 'Task Rejected' end,
    case when p_action='approve' then format('Your task "%s" has been approved! %s',task_row.task_title,
      case when on_time then '(Completed on time - +1 point)' else '(Completed late - -1 point)' end)
      else format('Your task "%s" was rejected. Reason: %s',task_row.task_title,p_reason) end,
    task_row.project_id,p_task,p_submission,false);
  return jsonb_build_object('success',true,'message',format('Task %s successfully',outcome),
    'task',jsonb_build_object('id',p_task,'status',outcome,'is_on_time',on_time,'productivity_points',score));
end;
$function$
;


CREATE OR REPLACE FUNCTION app_private.storage_org(p_bucket text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare segment text; org uuid;
begin
  segment := split_part(p_name,'/',1);
  if p_bucket='task-submissions' then
    if segment='pm' then segment:=split_part(p_name,'/',2);
    elsif segment='submissions' then
      select t.organization_id into org from public.developer_tasks t where t.id::text=split_part(p_name,'/',4)
        and t.project_id::text=split_part(p_name,'/',3);
      return org;
    end if;
  end if;
  select id into org from public.organizations where id::text=segment;
  if org is not null then return org; end if;
  -- Legacy screenshot paths are attributed by the existing database record,
  -- never by guessing from an email local-part or trusting upload metadata.
  if p_bucket in ('screenshots','documents','monitoring') then
    select min(s.organization_id::text)::uuid into org from public.screenshots s
      where s.storage_path=p_name having count(distinct s.organization_id)=1;
  end if;
  return org;
end; $function$
;


CREATE OR REPLACE FUNCTION app_private.deletion_storage_org(p_bucket text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare segment text:=split_part(p_name,'/',1); candidate uuid; legacy uuid; n int;
begin
 if p_bucket not in ('task-submissions','monitoring','org-files','invoices') then return null; end if;
 if p_bucket='monitoring' and not exists(select 1 from public.developers where organization_id::text=segment and id::text=split_part(p_name,'/',2) and split_part(p_name,'/',3)<>'') then return null; end if;
 if p_bucket='task-submissions' then
  if segment='pm' then segment:=split_part(p_name,'/',2);
  elsif segment='submissions' then
   select t.organization_id into candidate from public.developer_tasks t where t.id::text=split_part(p_name,'/',4) and t.project_id::text=split_part(p_name,'/',3);
   return candidate;
  end if;
 end if;
 select id into candidate from public.organizations where id::text=segment;
 if p_bucket in ('screenshots','documents','monitoring') then
  select count(distinct organization_id),min(organization_id::text)::uuid into n,legacy from public.screenshots where storage_path=p_name;
  if n>1 or (candidate is not null and legacy is not null and candidate<>legacy) then return null; end if;
  -- Mutable screenshot rows are not independent ownership proof. Legacy
  -- paths remain unresolved and block deletion when referenced by this org.
 end if;
 return candidate;
end $function$
;


-- Proof paths retain their existing layout. Resolve their task and profile type
-- before authorizing access; a matching UUID alone cannot authorize an upload.
create or replace function public.auth_typed_task_proof(p_name text,p_write boolean)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare parts text[]; task_row public.developer_tasks%rowtype;
begin
 if public.auth_is_client() then return false; end if;
 parts:=string_to_array(p_name,'/');
 if cardinality(parts)<>5 or parts[1]<>'submissions' or nullif(parts[5],'') is null or parts[5] in ('.','..') then return false; end if;
 select * into task_row from public.developer_tasks where id=public.try_uuid(parts[4])
  and organization_id=public.auth_org() and project_id=public.try_uuid(parts[3]);
 if not found or coalesce(task_row.developer_id,task_row.assignee_admin_id) is distinct from public.try_uuid(parts[2]) then return false; end if;
 if not p_write then return true; end if;
 return task_row.status<>'completed' and (public.auth_task_capability('task.manage') or
   public.task_assigned_to(task_row.developer_id,task_row.assignee_admin_id,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type'));
end $$;
revoke all on function public.auth_typed_task_proof(text,boolean) from public,anon;
grant execute on function public.auth_typed_task_proof(text,boolean) to authenticated,service_role;
create policy typed_task_proof_read on storage.objects for select to authenticated
 using(bucket_id='task-submissions' and public.auth_typed_task_proof(name,false));
create policy typed_task_proof_insert on storage.objects for insert to authenticated
 with check(bucket_id='task-submissions' and public.auth_typed_task_proof(name,true));
create policy task_proof_current_read on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'task-submissions' or split_part(name,'/',1)<>'submissions' or public.auth_typed_task_proof(name,false));
create policy task_proof_current_insert on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'task-submissions' or split_part(name,'/',1)<>'submissions' or public.auth_typed_task_proof(name,true));

create policy submission_typed_own_read on public.task_submissions for select to authenticated
 using(organization_id=public.auth_org() and public.auth_task_capability('task.view_own') and
  public.task_assigned_to(developer_id,assignee_admin_id,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type'));
create policy submission_task_management_read on public.task_submissions for select to authenticated
 using(organization_id=public.auth_org() and (public.auth_task_capability('task.view_all') or public.auth_task_capability('task.review')));
-- Reading historical proof never grants access to the current assignee's work.
create policy submission_current_task_read on public.task_submissions as restrictive for select to authenticated
 using(exists(select 1 from public.developer_tasks t where t.id=task_submissions.task_id and t.organization_id=task_submissions.organization_id)
 and (public.auth_is_client() or public.auth_task_capability('task.view_all') or public.auth_task_capability('task.review')
  or (public.auth_task_capability('task.view_own') and public.task_assigned_to(developer_id,assignee_admin_id,public.auth_app_user_id(),auth.jwt()->'app_metadata'->>'user_type'))));

CREATE OR REPLACE FUNCTION public.apply_actor_automation_action(p_job uuid, p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare job public.automation_jobs%rowtype; task public.developer_tasks%rowtype; action jsonb; desired text; allowed boolean; old_context text; rule_project uuid; rule_enabled boolean;
begin
 select * into job from public.automation_jobs where id=p_job and lease=p_lease and status='processing' and lease_until>now();
 if not found then raise exception 'Automation lease or actor access is no longer valid' using errcode='42501'; end if;
 if not public.auth_plan_feature('automation') then raise exception 'Automation plan feature is unavailable' using errcode='42501'; end if;
 select * into task from public.developer_tasks where id=job.task_id and organization_id=job.organization_id for update;
 if not found then raise exception 'Automation task is no longer accessible' using errcode='42501'; end if;
 select r.project_id,r.enabled into rule_project,rule_enabled from public.automation_rules r where r.id=job.rule_id and r.organization_id=job.organization_id;
 if not found or not coalesce(rule_enabled,false) then raise exception 'Automation rule is no longer enabled or accessible' using errcode='42501'; end if;
 if rule_project is not null and rule_project is distinct from task.project_id then raise exception 'Automation project scope changed since dispatch' using errcode='PT409'; end if;
 action:=job.actions->job.next_action;
 old_context:=current_setting('app.automation_job',true);
 perform set_config('app.automation_job',job.id::text,true);
 case action->>'type'
 when 'assign' then
  desired:=action->>'userId';
  if public.try_uuid(desired) is null then raise exception 'Invalid automation assignee' using errcode='22023'; end if;
  if (task.developer_id is distinct from public.try_uuid(desired) or task.assignee_admin_id is not null) and (task.developer_id::text is distinct from job.task_snapshot->>'developer_id' or task.assignee_admin_id::text is distinct from job.task_snapshot->>'assignee_admin_id') then raise exception 'Automation task changed since dispatch' using errcode='PT409'; end if;
  update public.developer_tasks set developer_id=desired::uuid,assignee_admin_id=null,updated_at=now() where id=task.id returning * into task;
 when 'set_priority' then
  desired:=action->>'priority';
  if desired not in ('low','medium','high','urgent') or desired is null then raise exception 'Invalid automation priority' using errcode='22023'; end if;
  if task.priority is distinct from desired and task.priority is distinct from job.task_snapshot->>'priority' then raise exception 'Automation task changed since dispatch' using errcode='PT409'; end if;
  update public.developer_tasks set priority=desired,updated_at=now() where id=task.id returning * into task;
 when 'set_status' then
  desired:=action->>'status';
  allowed:=desired=task.status or case coalesce(task.status,'pending')
   when 'pending' then desired in ('in_progress','awaiting_approval') when 'in_progress' then desired in ('pending','awaiting_approval')
   when 'awaiting_approval' then desired in ('in_progress','reviewed') when 'reviewed' then desired in ('awaiting_approval','in_progress')
   when 'rejected' then desired='in_progress' else false end;
  if not coalesce(allowed,false) or desired in ('completed','rejected') then raise exception 'Automation status transition is not permitted' using errcode='22023'; end if;
  if task.status is distinct from desired and task.status is distinct from job.task_snapshot->>'status' then raise exception 'Automation task changed since dispatch' using errcode='PT409'; end if;
  update public.developer_tasks set status=desired,updated_at=now() where id=task.id returning * into task;
 when 'add_label' then
  desired:=nullif(btrim(action->>'label'),'');
  if desired is null then raise exception 'Automation label is required' using errcode='22023'; end if;
  update public.developer_tasks set labels=case when desired=any(coalesce(labels,'{}')) then labels else array_append(coalesce(labels,'{}'),desired) end,updated_at=now() where id=task.id returning * into task;
 else raise exception 'Action requires the notification/email dispatcher' using errcode='22023';
 end case;
 if not found then raise exception 'Automation task was not changed; check current permissions' using errcode='42501'; end if;
 perform set_config('app.automation_job',coalesce(old_context,''),true);
 return to_jsonb(task);
end $function$
;

CREATE OR REPLACE FUNCTION public.spawn_recurring_task(p_template uuid, p_expected_recurrence jsonb, p_expected_anchor date, p_expected_next date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare org uuid; template public.developer_tasks; anchor date; next_day date; payload jsonb; columns_sql text; child uuid;
begin
 if p_template is null or p_expected_recurrence is null or p_expected_anchor is null or p_expected_next is null then
  raise exception 'RECURRENCE_SNAPSHOT_REQUIRED' using errcode='22023'; end if;
 select organization_id into org from public.developer_tasks where id=p_template;
 if org is null then return jsonb_build_object('spawned',false,'reason','template_missing'); end if;
 perform 1 from public.organizations where id=org for update;
 if not found or app_private.organization_deleting(org) then raise exception 'ORGANIZATION_UNAVAILABLE' using errcode='42501'; end if;
 perform app_private.lock_quota(org);
 select * into template from public.developer_tasks where id=p_template for update;
 if not found or template.organization_id is distinct from org or template.is_recurring is not true then
  return jsonb_build_object('spawned',false,'reason','template_changed'); end if;
 if template.recurrence is distinct from p_expected_recurrence then return jsonb_build_object('spawned',false,'reason','template_changed'); end if;
 if not app_private.org_unlocked(org) or not app_private.plan_feature(org,'automation') then
  raise exception 'AUTOMATION_PLAN_UNAVAILABLE' using errcode='42501'; end if;
 if nullif(template.recurrence->>'last_spawned','') is not null then
  if template.recurrence->>'last_spawned' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_RECURRENCE_CURSOR' using errcode='22023'; end if;
  anchor:=(template.recurrence->>'last_spawned')::date;
 else anchor:=coalesce(template.due_date,template.end_date); end if;
 if anchor is distinct from p_expected_anchor then return jsonb_build_object('spawned',false,'reason','template_changed'); end if;
 next_day:=app_private.recurring_next_date(anchor,template.recurrence);
 if next_day is distinct from p_expected_next then raise exception 'RECURRENCE_NEXT_DATE_MISMATCH' using errcode='22023'; end if;
 if next_day>(now() at time zone 'UTC')::date then return jsonb_build_object('spawned',false,'reason','not_due'); end if;
 if not exists(select 1 from public.projects p where p.id=template.project_id and p.organization_id=org) then
  raise exception 'RECURRING_PROJECT_UNAVAILABLE' using errcode='42501'; end if;
 if template.developer_id is not null and not exists(select 1 from public.memberships m
  join public.developers d on d.id=m.user_id and d.organization_id=m.organization_id
  where m.organization_id=org and m.user_id=template.developer_id and m.user_type='developer' and m.status='active'
   and m.role<>'client' and not coalesce((to_jsonb(m)->>'deletion_blocked')::boolean,false)) then
  raise exception 'RECURRING_ASSIGNEE_UNAVAILABLE' using errcode='42501'; end if;
 if template.assignee_admin_id is not null and not exists(select 1 from public.memberships m where m.organization_id=org and m.user_id=template.assignee_admin_id and m.user_type='admin' and m.status='active' and m.role<>'client' and not m.deletion_blocked) then
  raise exception 'RECURRING_ASSIGNEE_UNAVAILABLE' using errcode='42501'; end if;
 payload:=to_jsonb(template)||jsonb_build_object('status','pending','start_date',next_day,'end_date',next_day,'due_date',next_day,'is_recurring',false,'recurrence','{}'::jsonb);
 -- Copy only definition fields; completion, review and measured work start
 -- fresh. Database defaults and all existing quota/assignment triggers run.
 select string_agg(format('%I',a.attname),',' order by a.attnum) into columns_sql from pg_attribute a
 where a.attrelid='public.developer_tasks'::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attname=any(array[
  'organization_id','project_id','developer_id','assignee_admin_id','task_title','task_description','task_order','task_type','client_visible',
  'priority','story_points','estimated_hours','tags','labels','custom_fields','position','parent_task_id','sprint_id','epic_id',
  'severity','steps_to_reproduce','environment','reported_by','status','start_date','end_date','due_date','is_recurring','recurrence']);
 execute format('insert into public.developer_tasks(%s) select %s from jsonb_populate_record(null::public.developer_tasks,$1) returning id',columns_sql,columns_sql)
 into child using payload;
 update public.developer_tasks set recurrence=template.recurrence||jsonb_build_object('last_spawned',to_char(next_day,'YYYY-MM-DD')) where id=p_template;
 insert into public.pm_activity(organization_id,project_id,entity_type,entity_id,action,meta)
 values(org,template.project_id,'task',p_template,'recurring_spawned',jsonb_build_object('next',next_day,'spawnedTaskId',child));
 return jsonb_build_object('spawned',true,'taskId',child,'next',next_day);
end $function$
;

notify pgrst, 'reload schema';
commit;
