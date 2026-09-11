begin;
create or replace function public.commit_task_submission(p_org uuid,p_actor uuid,p_profile_type text,p_task uuid,p_project uuid,
  p_file_url text,p_file_name text,p_storage_path text,p_notes text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
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
  if task_row.status='completed' or task_row.developer_id is null then
    raise exception 'SUBMISSION_CONFLICT: completed or unassigned task cannot be submitted';
  end if;
  own_assignment:=p_profile_type='developer' and p_actor=task_row.developer_id;
  permission:=case when own_assignment then 'task.submit' else 'task.manage' end;
  defaults:=case when own_assignment then member_row.role in ('developer','designer','devops','qa','employee','team_lead')
    else member_row.role in ('owner','admin','manager','team_lead') end;
  if not coalesce((select allowed from public.user_permissions where membership_id=member_row.id and permission_key=permission),defaults,false) then
    raise exception 'SUBMISSION_FORBIDDEN: submit permission required' using errcode='42501';
  end if;
  select * into project_row from public.projects where id=p_project and organization_id=p_org;
  if not found then raise exception 'SUBMISSION_NOT_FOUND: project not found' using errcode='P0002'; end if;
  select name into developer_name from public.developers where id=task_row.developer_id and organization_id=p_org;
  if not found then raise exception 'SUBMISSION_INVALID: assignee does not belong to organization' using errcode='22023'; end if;
  prefix:=format('submissions/%s/%s/%s/',task_row.developer_id,p_project,p_task);
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
    if submission_row.storage_path is distinct from p_storage_path or submission_row.developer_id is distinct from task_row.developer_id then
      raise exception 'SUBMISSION_CONFLICT: task already has pending proof';
    end if;
    if task_row.status in ('awaiting_approval','reviewed') then
      return jsonb_build_object('success',true,'message','Task already submitted for review','submission',to_jsonb(submission_row),
        'isOnTime',(submission_row.submitted_at at time zone 'UTC')::date<=task_row.end_date);
    end if;
    submitted_time:=submission_row.submitted_at;
  else
    insert into public.task_submissions(organization_id,task_id,project_id,developer_id,file_url,file_name,file_type,file_size,
      storage_path,submission_notes,submitted_at,is_reviewed,review_status)
    values(p_org,p_task,p_project,task_row.developer_id,p_file_url,p_file_name,coalesce(metadata->>'mimetype','application/octet-stream'),
      app_private.object_bytes(metadata),p_storage_path,coalesce(p_notes,''),submitted_time,false,'pending') returning * into submission_row;
  end if;
  update public.developer_tasks set status='awaiting_approval',submitted_at=submitted_time,reviewed_by=null,reviewed_at=null,
    rejection_reason=null,admin_comments=null,updated_at=now() where id=p_task;
  description:=format('Task "%s" submitted for review%s%s',task_row.task_title,
    case when own_assignment then '' else ' on their behalf by a supervisor' end,
    case when task_row.status='rejected' and task_row.rejection_reason is not null then
      format(' (previous verdict cleared: rejected — %s)',task_row.rejection_reason) else '' end);
  insert into public.activity_logs(organization_id,developer_id,project_id,task_id,action_type,action_description,old_value,new_value)
    values(p_org,task_row.developer_id,p_project,p_task,'task_submitted',description,task_row.status,'awaiting_approval');
  insert into public.notifications(organization_id,admin_id,developer_id,type,title,message,project_id,task_id,submission_id,read)
    values(p_org,coalesce(project_row.created_by,project_row.added_by),task_row.developer_id,'review_required','Task Submission for Review',
      format('%s has submitted "%s" for review in project "%s"',coalesce(developer_name,'Developer'),task_row.task_title,project_row.name),
      p_project,p_task,submission_row.id,false);
  return jsonb_build_object('success',true,'message','Task submitted successfully for review','submission',to_jsonb(submission_row),
    'isOnTime',(submitted_time at time zone 'UTC')::date<=task_row.end_date);
end;
$$;
revoke all on function public.commit_task_submission(uuid,uuid,text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.commit_task_submission(uuid,uuid,text,uuid,uuid,text,text,text,text) to service_role;
commit;
