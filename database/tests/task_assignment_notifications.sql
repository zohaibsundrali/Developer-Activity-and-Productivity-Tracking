\set ON_ERROR_STOP on
\ir notification_insert_authority.sql
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
alter table developer_tasks add column task_title text,add column task_type text default 'feature';
alter table memberships add column id uuid default gen_random_uuid();
create table user_permissions(membership_id uuid,permission_key text,allowed boolean);
alter table notifications add column metadata jsonb default '{}';
\ir ../../supabase/migrations/20260911133042_production_transactional_task_assignment_notifications.sql
create function assignment_fail_notice() returns trigger language plpgsql as $$ begin
 if current_setting('test.assignment_fail',true)='yes' then raise exception 'INJECTED_NOTICE_FAILURE'; end if;
 return new;
end $$;
create trigger assignment_failure before insert on notifications for each row execute function assignment_fail_notice();
do $$ declare org uuid:='00000000-0000-0000-0000-000000000001'; first_user uuid:='00000000-0000-0000-0000-000000000011'; second_user uuid:='00000000-0000-0000-0000-000000000012';
 task uuid:='77000000-0000-0000-0000-000000000299'; parent uuid:='77000000-0000-0000-0000-000000000101'; before_count bigint;
begin
 -- Admin UUID collides with assignee but is a distinct actor: do not self-skip.
 perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('organization_id',org,'app_user_id',first_user,'user_type','admin'))::text,true);
 select count(*) into before_count from notifications;
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title) values(task,org,parent,first_user,'Original title');
 if (select count(*) from notifications)<>before_count+1 then raise exception 'Initial assignment missing or incorrect typed self-skip'; end if;
 update developer_tasks set developer_id=second_user,task_title='New title' where id=task;
 if (select count(*) from notifications)<>before_count+3 then raise exception 'Reassignment must notify both people'; end if;
 if not exists(select 1 from notifications where type='task_reassigned_away' and developer_id=first_user and metadata=jsonb_build_object('taskTitle','Original title')
  and task_id is null and project_id is null and submission_id is null and entity_id is null and message='"Original title" is no longer assigned to you.') then raise exception 'Removal snapshot leaked current references/title'; end if;
 update developer_tasks set developer_id=second_user where id=task;
 if (select count(*) from notifications)<>before_count+3 then raise exception 'No-op assignment duplicated notice'; end if;
 update developer_tasks set developer_id=null where id=task;
 if not exists(select 1 from notifications where type='task_unassigned' and developer_id=second_user and task_id is null and project_id is null) then raise exception 'Unassignment notice missing'; end if;
 -- Muted recipients suppress only their own notice, never the assignment.
 insert into notification_preferences(organization_id,user_id,user_type,category,enabled) values(org,second_user,'developer','assignment',false);
 select count(*) into before_count from notifications;
 update developer_tasks set developer_id=second_user where id=task;
 if (select count(*) from notifications)<>before_count or (select developer_id from developer_tasks where id=task)<>second_user then raise exception 'Mute broke assignment or did not suppress'; end if;
 -- Any notification error rolls the task change and all earlier sibling notices back.
 perform set_config('test.assignment_fail','yes',true);
 begin update developer_tasks set developer_id=first_user where id=task;
 raise exception 'Expected notification failure'; exception when raise_exception then if sqlerrm<>'INJECTED_NOTICE_FAILURE' then raise; end if; end;
 perform set_config('test.assignment_fail','no',true);
 if (select developer_id from developer_tasks where id=task)<>second_user or (select count(*) from notifications)<>before_count then raise exception 'Assignment failed nonatomically'; end if;
 -- Browser cannot impersonate even the no-live-reference removal event.
 set local role authenticated;
 perform expect_notice_denied('{"type":"task_reassigned_away"}');
 perform expect_notice_denied('{"type":"task_unassigned"}');
 reset role;
 -- A developer assigning themselves does not get a redundant self-notice.
 perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('organization_id',org,'app_user_id',first_user,'user_type','developer'))::text,true);
 select count(*) into before_count from notifications;
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title) values('77000000-0000-0000-0000-000000000298',org,parent,first_user,'Self task');
 if (select count(*) from notifications)<>before_count then raise exception 'Self-notice generated'; end if;
 -- Permission denial on the target must not leak the assigned title.
 insert into user_permissions select id,'task.view_own',false from memberships where user_id=first_user and user_type='developer';
 perform set_config('request.jwt.claims','{}',true);
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title) values('77000000-0000-0000-0000-000000000297',org,parent,first_user,'Denied own permission');
 if (select count(*) from notifications)<>before_count then raise exception 'Denied target received task title'; end if;
end $$;
