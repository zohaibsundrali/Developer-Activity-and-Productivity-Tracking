\set ON_ERROR_STOP on
\ir task_assignment_notifications.sql
create table sprints(id uuid primary key,organization_id uuid,project_id uuid,name text,status text);
alter table developer_tasks add column sprint_id uuid;
\ir ../../supabase/migrations/20260911163008_production_atomic_sprint_notifications.sql
-- Test actual notification triggers, recipient canonicalization and preference
-- filtering together; this fixture runs only in a disposable database.
do $$ declare org uuid:='00000000-0000-0000-0000-000000000001'; sprint uuid:='81000000-0000-0000-0000-000000000001'; parent uuid:='77000000-0000-0000-0000-000000000101'; n bigint; begin
 perform set_config('test.assignment_fail','no',true);
 delete from user_permissions;
 delete from notification_preferences where category='sprint';
 update memberships set status='active',role='developer' where organization_id=org and user_type='developer' and user_id in ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012');
 insert into sprints values(sprint,org,parent,'Release sprint','planned');
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,sprint_id) values
 ('81000000-0000-0000-0000-000000000101',org,parent,'00000000-0000-0000-0000-000000000011','One',sprint),
 ('81000000-0000-0000-0000-000000000102',org,parent,'00000000-0000-0000-0000-000000000011','Two',sprint),
 ('81000000-0000-0000-0000-000000000103',org,parent,'00000000-0000-0000-0000-000000000012','Three',sprint);
 -- Invalid historical cross-org task cannot leak an event to its assignee.
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,sprint_id) values
 ('81000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000002',null,'00000000-0000-0000-0000-000000000014','Foreign',sprint);
 update sprints set status='active' where id=sprint;
 select count(*) into n from notifications where type='sprint_started';
 if n<>2 then raise exception 'Expected exactly two typed recipients, got %',n; end if;
 if exists(select 1 from notifications where type='sprint_started' and (task_id is null or entity_type<>'task' or admin_id is not null or organization_id<>org)) then raise exception 'Unsafe sprint notice identity/navigation'; end if;
 update sprints set status='active' where id=sprint;
 if (select count(*) from notifications where type='sprint_started')<>n then raise exception 'Retry duplicated notices'; end if;
 update sprints set status='planned' where id=sprint;
 update sprints set status='active' where id=sprint;
 if (select count(*) from notifications where type='sprint_started')<>4 then raise exception 'Reopened sprint suppressed'; end if;
 insert into notification_preferences(organization_id,user_id,user_type,category,enabled) values(org,'00000000-0000-0000-0000-000000000012','developer','sprint',false);
 update sprints set status='completed' where id=sprint;
 if (select count(*) from notifications where type='sprint_completed')<>1 then raise exception 'Sprint preference ignored'; end if;
 -- The first recipient explicitly loses every task-read capability.
 insert into user_permissions(membership_id,permission_key,allowed)
 select m.id,p,false from memberships m cross join unnest(array['task.view_own','task.view_all','task.review','bug.triage']) p
 where organization_id=org and user_type='developer' and user_id='00000000-0000-0000-0000-000000000011';
 update sprints set status='active' where id=sprint;
 if (select count(*) from notifications where type='sprint_started')<>4 then raise exception 'Denied/muted recipient notified'; end if;
 delete from user_permissions;
 perform set_config('test.assignment_fail','yes',true);
 begin
  update sprints set status='completed' where id=sprint;
  raise exception 'Expected notification failure';
 exception when others then if sqlerrm<>'INJECTED_NOTICE_FAILURE' then raise; end if; end;
 if (select status from sprints where id=sprint)<>'active' then raise exception 'Failed notice committed sprint'; end if;
 if (select count(*) from notifications where type='sprint_completed')<>1 then raise exception 'Partial notification committed'; end if;
 perform set_config('test.assignment_fail','no',true);
 set local role authenticated;
 perform expect_notice_denied('{"type":"sprint_started"}');
 perform expect_notice_denied('{"type":"sprint_completed"}');
 reset role;
end $$;
