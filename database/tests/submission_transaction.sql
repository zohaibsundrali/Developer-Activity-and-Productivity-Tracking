alter table task_submissions add column if not exists project_id uuid,add column file_name text,add column file_type text,
  add column file_size int,add column storage_path text,add column submission_notes text;
do $$ declare org uuid:='00000000-0000-0000-0000-000000000095'; developer uuid:=gen_random_uuid();
  project uuid; task uuid; path text; result jsonb;
begin
  insert into organizations values(org);
  insert into organization_subscriptions(organization_id,plan_code,status) values(org,'professional','active');
  insert into developers(id,organization_id,name,status) values(developer,org,'Contributor','active');
  insert into memberships(organization_id,user_id,user_type,role,status) values(org,developer,'developer','developer','active');
  insert into projects(organization_id,name,created_by) values(org,'Project',gen_random_uuid()) returning id into project;
  insert into developer_tasks(organization_id,project_id,developer_id,status,task_title,end_date,rejection_reason)
    values(org,project,developer,'rejected','Work',current_date,'Missing tests') returning id into task;
  path:=format('submissions/%s/%s/%s/proof.pdf',developer,project,task);
  perform expect_rejected(format('select commit_task_submission(%L,%L,''developer'',%L,%L,''https://proof'',''proof.pdf'',%L,'''')',org,developer,task,project,path),'SUBMISSION_INVALID');
  insert into storage.objects(bucket_id,name,metadata) values('task-submissions',path,'{"size":10,"mimetype":"application/pdf"}');
  perform expect_rejected(format('select commit_task_submission(%L,%L,''developer'',%L,%L,''https://proof'',''proof.pdf'',%L,'''')',org,developer,task,gen_random_uuid(),path),'SUBMISSION_INVALID');
  perform set_config('test.fail_notification','yes',true);
  perform expect_rejected(format('select commit_task_submission(%L,%L,''developer'',%L,%L,''https://proof'',''proof.pdf'',%L,'''')',org,developer,task,project,path),'INJECTED_FAILURE');
  if exists(select 1 from task_submissions where task_id=task) or (select status from developer_tasks where id=task)<>'rejected' then raise exception 'Partial submission survived'; end if;
  perform set_config('test.fail_notification','no',true);
  insert into user_permissions(membership_id,permission_key,allowed) select id,'task.submit',false from memberships where organization_id=org;
  perform expect_rejected(format('select commit_task_submission(%L,%L,''developer'',%L,%L,''https://proof'',''proof.pdf'',%L,'''')',org,developer,task,project,path),'SUBMISSION_FORBIDDEN');
  delete from user_permissions where membership_id in(select id from memberships where organization_id=org);
  set local role authenticated;
  perform expect_rejected(format('select commit_task_submission(%L,%L,''developer'',%L,%L,''https://proof'',''proof.pdf'',%L,'''')',org,developer,task,project,path),'permission denied');
  reset role;
  set local role service_role;
  result:=commit_task_submission(org,developer,'developer',task,project,'https://proof','proof.pdf',path,'Notes');
  reset role;
  if result->'submission'->>'developer_id'<>developer::text or result->'submission'->>'file_size'<>'10' then raise exception 'Attribution or proof metadata incorrect'; end if;
  if (select status from developer_tasks where id=task)<>'awaiting_approval' or (select rejection_reason from developer_tasks where id=task) is not null then raise exception 'Task not transitioned'; end if;
  if not exists(select 1 from activity_logs where task_id=task and action_description like '%Missing tests%') then raise exception 'Cleared verdict lost'; end if;
  perform commit_task_submission(org,developer,'developer',task,project,'https://proof','proof.pdf',path,'Notes');
  if (select count(*) from task_submissions where task_id=task)<>1 or (select count(*) from notifications where task_id=task)<>1 then raise exception 'Retry duplicated submission'; end if;
  -- Synthetic metadata cleanup only: no real files exist in this fixture.
  delete from storage.objects where bucket_id='task-submissions' and name=path;
  delete from organizations where id=org;
end $$;
