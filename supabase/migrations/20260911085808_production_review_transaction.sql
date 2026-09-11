begin;
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
  select * into member_row from public.memberships where organization_id=p_org and user_id=p_reviewer
    and user_type=p_profile_type and status='active';
  if not found or not coalesce((select allowed from public.user_permissions where membership_id=member_row.id
    and permission_key='task.review'),member_row.role in ('owner','admin','manager','team_lead','qa'),false) then
    raise exception 'REVIEW_FORBIDDEN: reviewer permission required' using errcode='42501';
  end if;
  perform app_private.lock_quota(p_org);
  if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
  select * into task_row from public.developer_tasks where id=p_task and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: task not found' using errcode='P0002'; end if;
  select * into project_row from public.projects where id=task_row.project_id and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: project not found' using errcode='P0002'; end if;
  if not coalesce(project_row.created_by::text=p_reviewer::text or project_row.added_by::text=p_reviewer::text,false) then
    raise exception 'REVIEW_FORBIDDEN: project ownership required' using errcode='42501';
  end if;
  select * into submission_row from public.task_submissions where id=p_submission and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: submission not found' using errcode='P0002'; end if;
  if submission_row.task_id is distinct from p_task then raise exception 'REVIEW_INVALID: mismatched task' using errcode='22023'; end if;
  if p_reviewer=task_row.developer_id or p_reviewer=submission_row.developer_id then
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
  insert into public.notifications(organization_id,developer_id,admin_id,type,title,message,project_id,task_id,submission_id,read)
  values(p_org,task_row.developer_id,p_reviewer,
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
commit;
