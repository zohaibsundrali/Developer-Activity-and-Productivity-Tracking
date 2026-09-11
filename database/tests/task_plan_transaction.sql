do $$ declare org uuid:='00000000-0000-0000-0000-000000000097';
  project uuid; contributor uuid:=gen_random_uuid(); draft uuid; started uuid; submitted uuid; commented uuid;
  payload jsonb:='[{"task_title":"New task","start_date":"2026-09-11","end_date":"2026-09-12"}]'; result jsonb; full_plan jsonb;
begin
  insert into organizations values(org);
  insert into organization_subscriptions(organization_id,plan_code,status) values(org,'professional','active');
  insert into memberships(organization_id,user_id,user_type,role,status) values(org,contributor,'developer','developer','active');
  insert into projects(organization_id,assigned_developer_id,task_plan_status) values(org,contributor,'draft') returning id into project;
  insert into developer_tasks(organization_id,project_id,developer_id,status) values(org,project,contributor,'pending') returning id into draft;
  insert into developer_tasks(organization_id,project_id,developer_id,status) values(org,project,contributor,'in_progress') returning id into started;
  insert into developer_tasks(organization_id,project_id,developer_id,status) values(org,project,contributor,'pending') returning id into submitted;
  insert into task_submissions(task_id) values(submitted);
  insert into developer_tasks(organization_id,project_id,developer_id,status) values(org,project,contributor,'pending') returning id into commented;
  insert into task_comments_fixture(task_id,body) values(commented,'Keep this discussion');
  perform expect_rejected(format('select save_and_submit_task_plan(%L,%L,%L,%L::jsonb)',org,project,contributor,payload||payload||payload),'PLAN_LIMIT_REACHED');
  if not exists(select 1 from developer_tasks where id=draft) or (select task_plan_status from projects where id=project)<>'draft' then raise exception 'Failed insert lost the prior plan'; end if;
  perform expect_rejected(format('select save_and_submit_task_plan(%L,%L,%L,%L::jsonb)',org,project,gen_random_uuid(),payload),'PLAN_FORBIDDEN');
  perform expect_rejected(format('select save_and_submit_task_plan(%L,%L,%L,%L::jsonb)',org,project,contributor,
    '[{"task_title":"Invalid range","start_date":"2026-09-12","end_date":"2026-09-11"}]'),'INVALID_PLAN');
  insert into user_permissions(membership_id,permission_key,allowed)
    select id,'task.update_own',false from memberships where organization_id=org and user_id=contributor and user_type='developer';
  perform expect_rejected(format('select save_and_submit_task_plan(%L,%L,%L,%L::jsonb)',org,project,contributor,payload),'PLAN_FORBIDDEN');
  delete from user_permissions where membership_id in(select id from memberships where organization_id=org);
  set local role authenticated;
  perform expect_rejected(format('select save_and_submit_task_plan(%L,%L,%L,%L::jsonb)',org,project,contributor,payload),'permission denied');
  reset role;
  set local role service_role;
  result:=save_and_submit_task_plan(org,project,contributor,payload);
  reset role;
  if result->'project'->>'task_plan_status'<>'pending' then raise exception 'Plan not submitted atomically'; end if;
  if exists(select 1 from developer_tasks where id=draft) then raise exception 'Draft not replaced'; end if;
  if (select count(*) from developer_tasks where id in (started,submitted,commented))<>3 or not exists(select 1 from task_submissions where task_id=submitted) then raise exception 'Existing work lost'; end if;
  update projects set task_plan_status='rejected' where id=project;
  select jsonb_agg(jsonb_build_object('id',id,'task_title',coalesce(task_title,'Existing'),
    'start_date',coalesce(start_date,'2026-09-11'::date),'end_date',coalesce(end_date,'2026-09-12'::date)))
    into full_plan from developer_tasks where project_id=project;
  perform expect_rejected(format('select save_and_submit_task_plan(%L,%L,%L,%L::jsonb)',org,project,contributor,full_plan||full_plan),'INVALID_PLAN');
  perform save_and_submit_task_plan(org,project,contributor,full_plan);
  if (select count(*) from developer_tasks where project_id=project)<>4 then raise exception 'Full UI plan duplicated preserved tasks'; end if;
  if not exists(select 1 from task_comments_fixture where task_id=commented) then raise exception 'Full plan lost linked comments'; end if;
  perform save_and_submit_task_plan(org,project,contributor,payload||payload);
  if (select count(*) from developer_tasks where project_id=project)<>4 then raise exception 'Retry duplicated tasks'; end if;
  update projects set task_plan_status='approved' where id=project;
  perform expect_rejected(format('select save_and_submit_task_plan(%L,%L,%L,%L::jsonb)',org,project,contributor,payload),'PLAN_CONFLICT');
  delete from organizations where id=org;
end $$;
