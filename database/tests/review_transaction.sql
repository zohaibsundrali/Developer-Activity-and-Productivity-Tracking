do $$ declare org uuid:='00000000-0000-0000-0000-000000000096'; reviewer uuid:=gen_random_uuid();
  developer uuid:=gen_random_uuid(); project uuid; other_project uuid; replacement_developer uuid:=gen_random_uuid(); task uuid; submission uuid; result jsonb;
begin
  insert into organizations values(org);
  insert into organization_subscriptions(organization_id,plan_code,status) values(org,'professional','active');
  insert into memberships(organization_id,user_id,user_type,role,status) values(org,reviewer,'developer','qa','active');
  insert into projects(organization_id,created_by) values(org,reviewer) returning id into project;
  insert into developer_tasks(organization_id,project_id,developer_id,status,task_title,end_date)
    values(org,project,developer,'awaiting_approval','Review me','2026-09-11') returning id into task;
  insert into developer_tasks(organization_id,project_id,developer_id,status) values(org,project,gen_random_uuid(),'pending');
  insert into task_submissions(organization_id,task_id,project_id,developer_id,submitted_at)
    values(org,task,project,developer,'2026-09-11 23:59:59.999+00') returning id into submission;
  perform set_config('test.fail_notification','yes',true);
  perform expect_rejected(format('select commit_task_review(%L,%L,''developer'',''qa@example.test'',%L,%L,''approve'',null,null)',org,reviewer,task,submission),'INJECTED_FAILURE');
  if (select status from developer_tasks where id=task)<>'awaiting_approval' or
    (select is_reviewed from task_submissions where id=submission) or
    exists(select 1 from admin_reviews where organization_id=org) or
    exists(select 1 from productivity_metrics where organization_id=org) or
    exists(select 1 from activity_logs where organization_id=org) or
    (select progress from projects where id=project) is not null then raise exception 'Partial review survived rollback'; end if;
  perform set_config('test.fail_notification','no',true);
  update task_submissions set developer_id=reviewer where id=submission;
  perform expect_rejected(format('select commit_task_review(%L,%L,''developer'',''qa@example.test'',%L,%L,''approve'',null,null)',org,reviewer,task,submission),'REVIEW_FORBIDDEN');
  update task_submissions set developer_id=developer where id=submission;
  -- Proof remains attributed to the original developer after reassignment.
  update developer_tasks set developer_id=replacement_developer where id=task;
  perform expect_rejected(format('select commit_task_review(%L,%L,''developer'',''qa@example.test'',%L,%L,''approve'',null,null)',org,reviewer,task,submission),'REVIEW_CONFLICT');
  if (select status from developer_tasks where id=task)<>'awaiting_approval' or
    (select is_reviewed from task_submissions where id=submission) or
    exists(select 1 from admin_reviews where organization_id=org) or
    exists(select 1 from productivity_metrics where organization_id=org) or
    exists(select 1 from notifications where organization_id=org) then raise exception 'Stale assignee review changed records'; end if;
  update developer_tasks set developer_id=developer where id=task;
  insert into projects(organization_id,created_by) values(org,reviewer) returning id into other_project;
  update task_submissions set project_id=other_project where id=submission;
  perform expect_rejected(format('select commit_task_review(%L,%L,''developer'',''qa@example.test'',%L,%L,''reject'',null,''Wrong proof'')',org,reviewer,task,submission),'REVIEW_CONFLICT');
  if (select status from developer_tasks where id=task)<>'awaiting_approval' or
    (select review_status from task_submissions where id=submission)<>'pending' or
    exists(select 1 from admin_reviews where organization_id=org) or
    exists(select 1 from notifications where organization_id=org) then raise exception 'Mismatched project review changed records'; end if;
  update task_submissions set project_id=project where id=submission;
  set local role authenticated;
  perform expect_rejected(format('select commit_task_review(%L,%L,''developer'',''qa@example.test'',%L,%L,''approve'',null,null)',org,reviewer,task,submission),'permission denied');
  reset role;
  set local role service_role;
  result:=commit_task_review(org,reviewer,'developer','qa@example.test',task,submission,'approve','Good work',null);
  reset role;
  if result->'task'->>'productivity_points'<>'1' then raise exception 'On-time score incorrect'; end if;
  if (select progress from projects where id=project)<>50 or (select total_tasks_count from projects where id=project)<>2 then raise exception 'Project totals excluded other developer'; end if;
  if (select productivity_percentage from productivity_metrics where organization_id=org)<>100 then raise exception 'Developer total incorrect'; end if;
  perform expect_rejected(format('select commit_task_review(%L,%L,''developer'',''qa@example.test'',%L,%L,''approve'',null,null)',org,reviewer,task,submission),'REVIEW_CONFLICT');
  if (select count(*) from admin_reviews where organization_id=org)<>1 or (select count(*) from notifications where organization_id=org)<>1 then raise exception 'Review replay duplicated records'; end if;
  insert into user_permissions(membership_id,permission_key,allowed)
    select id,'task.review',false from memberships where organization_id=org;
  perform expect_rejected(format('select commit_task_review(%L,%L,''developer'',''qa@example.test'',%L,%L,''approve'',null,null)',org,reviewer,task,submission),'REVIEW_FORBIDDEN');
  delete from user_permissions where membership_id in(select id from memberships where organization_id=org);
  insert into developer_tasks(organization_id,project_id,developer_id,status,task_title,end_date)
    values(org,project,developer,'awaiting_approval','Late task','2026-09-11') returning id into task;
  insert into task_submissions(organization_id,task_id,project_id,developer_id,submitted_at)
    values(org,task,project,developer,'2026-09-12 00:00:00+00') returning id into submission;
  result:=commit_task_review(org,reviewer,'developer','qa@example.test',task,submission,'approve',null,null);
  if result->'task'->>'productivity_points'<>'-1' then raise exception 'Late score incorrect'; end if;
  insert into developer_tasks(organization_id,project_id,developer_id,status,task_title,end_date)
    values(org,project,developer,'awaiting_approval','Rejected task','2026-09-11') returning id into task;
  insert into task_submissions(organization_id,task_id,project_id,developer_id,submitted_at)
    values(org,task,project,developer,'2026-09-11 12:00:00+00') returning id into submission;
  result:=commit_task_review(org,reviewer,'developer','qa@example.test',task,submission,'reject',null,'Missing tests');
  if (select status from developer_tasks where id=task)<>'rejected' or
    (select review_status from task_submissions where id=submission)<>'rejected' or
    (select productivity_points from developer_tasks where id=task)<>0 then raise exception 'Rejection state diverged'; end if;
  delete from organizations where id=org;
end $$;
