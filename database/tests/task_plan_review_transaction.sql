-- Fresh isolated database. Real ownership helper and plan RPCs; billing state
-- is injected, while the physical lock matches the production quota lock.
\ir task_authorization_fixture.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
alter table memberships add column id uuid default gen_random_uuid(),add column email text;
alter table user_permissions add column membership_id uuid;
alter table projects add column name text,add column created_by uuid,add column added_by uuid,add column added_by_admin text,add column admin_id uuid,add column manager_id uuid,
 add column task_plan_submitted_at timestamptz,add column task_plan_reviewed_at timestamptz,add column task_plan_reviewed_by uuid,add column task_plan_rejection_reason text;
create table task_submissions(task_id uuid,organization_id uuid,developer_id uuid,review_status text);
create table notifications(id uuid primary key default gen_random_uuid(),organization_id uuid,developer_id uuid,type text,category text,title text,message text,
 project_id uuid,entity_type text,entity_id uuid,actor_id uuid,metadata jsonb,read boolean);
create schema app_private;
create table app_private.quota_locks(organization_id uuid primary key,revision bigint not null);
create function app_private.lock_quota(p_org uuid) returns void language sql volatile security definer set search_path=pg_catalog,public,app_private as $$
 insert into app_private.quota_locks(organization_id,revision) values(p_org,1)
 on conflict(organization_id) do update set revision=quota_locks.revision+1;
$$;
create function app_private.org_unlocked(p_org uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.plan_locked',true),'no')<>'yes' $$;
\ir ../../supabase/migrations/20260911113526_production_typed_project_ownership.sql
\ir ../../supabase/migrations/20260911113241_production_existing_plan_submission.sql
\ir ../../supabase/migrations/20260911113354_production_task_plan_review_transaction.sql
create function plan_test_failure() returns trigger language plpgsql as $$ begin
 if current_setting('test.plan_notice_failure',true)='yes' then raise exception 'INJECTED_NOTICE_FAILURE'; end if;return new;
end $$;
create trigger plan_notice_failure before insert on notifications for each row execute function plan_test_failure();
create function plan_review_denied(command text,expected text) returns void language plpgsql as $$ begin
 begin execute command; exception when others then if position(expected in sqlerrm)>0 then return; else raise; end if; end;
 raise exception 'Expected transaction refusal: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); developer uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); result jsonb; actor_member uuid;
begin
 insert into memberships(organization_id,user_id,user_type,role,status,email) values
 (org,actor,'admin','owner','active','owner@example.test'),(org,actor,'developer','qa','active','qa@example.test'),
 (org,developer,'developer','developer','active','dev@example.test');
 select id into actor_member from memberships where user_id=actor and user_type='admin';
 insert into projects(id,organization_id,name,assigned_developer_id,created_by,created_by_type,task_plan_status,task_plan_submitted)
 values(project,org,'Plan',developer,actor,'admin','pending',true);
 insert into developer_tasks(organization_id,project_id,developer_id,task_title,start_date,end_date) values(org,project,developer,'Saved plan task',current_date,current_date+1);
 set local role authenticated;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''admin'',''approve'')',org,project,actor),'permission denied');
 reset role;
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''developer'',''approve'')',org,project,actor),'project ownership or assigned manager required');
 reset role;
 insert into user_permissions(membership_id,permission_key,allowed) values(actor_member,'task.review',false);
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''admin'',''approve'')',org,project,actor),'reviewer permission required');
 reset role;
 delete from user_permissions;
 update developer_tasks set task_title=' ' where project_id=project;
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''admin'',''approve'')',org,project,actor),'valid date ranges');
 reset role;
 update developer_tasks set task_title='Saved plan task' where project_id=project;
 perform set_config('test.plan_locked','yes',true);
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''admin'',''approve'')',org,project,actor),'BILLING_LOCKED');
 reset role;
 perform set_config('test.plan_locked','no',true);
 perform set_config('test.plan_notice_failure','yes',true);
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''admin'',''approve'')',org,project,actor),'INJECTED_NOTICE_FAILURE');
 reset role;
 if (select task_plan_status from projects where id=project)<>'pending' or exists(select 1 from notifications) then raise exception 'Late failure leaked verdict or notice'; end if;
 perform set_config('test.plan_notice_failure','no',true);
 set local role service_role;
 result:=commit_task_plan_review(org,project,actor,'admin','approve');
 if result->>'success'<>'true' or (result->>'notifications')::int<>1 then raise exception 'Approval did not commit'; end if;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''admin'',''reject'',''different verdict'')',org,project,actor),'PLAN_REVIEW_CONFLICT');
 reset role;
 if (select count(*) from notifications)<>1 or (select developer_id from notifications)<>developer then raise exception 'Wrong notification recipient/count'; end if;
 -- A separate admin profile sharing the assigned developer UUID is not self-work.
 update projects set assigned_developer_id=actor,task_plan_status='pending' where id=project;
 set local role service_role;
 perform commit_task_plan_review(org,project,actor,'admin','reject',' revise scope ');
 reset role;
 if (select task_plan_rejection_reason from projects where id=project)<>'revise scope' then raise exception 'Rejection reason lost'; end if;
 update projects set created_by_type='developer',task_plan_status='pending' where id=project;
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''developer'',''approve'')',org,project,actor),'your own task plan');
 reset role;
 -- Legacy email ownership remains valid only when it resolves uniquely.
 update projects set created_by=null,created_by_type=null,added_by_admin='owner@example.test',assigned_developer_id=developer where id=project;
 update memberships set status='suspended' where user_id=developer;
 set local role service_role;
 result:=commit_task_plan_review(org,project,actor,'admin','approve');
 if (result->>'notifications')::int<>0 then raise exception 'Suspended assignee notified'; end if;
 reset role;
 update memberships set status='active' where user_id=developer;
 insert into user_permissions(membership_id,permission_key,allowed) select id,'project.view_own',false from memberships where user_id=developer;
 update projects set task_plan_status='pending' where id=project;
 set local role service_role;
 result:=commit_task_plan_review(org,project,actor,'admin','reject','private review');
 if (result->>'notifications')::int<>0 then raise exception 'Permission-denied assignee notified'; end if;
 reset role;
end $$;
-- Delegated review: project creation/assignment does not allow self-approval;
-- a distinct explicitly assigned manager can provide the independent verdict.
do $$ declare org uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid();
 stranger uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); member uuid; result jsonb;
begin
 insert into memberships(organization_id,user_id,user_type,role,status,email) values
 (org,lead,'developer','team_lead','active','lead@example.test'),
 (org,manager,'developer','manager','active','manager@example.test'),
 (org,manager,'admin','admin','active','collision@example.test'),
 (org,stranger,'developer','qa','active','stranger@example.test');
 select id into member from memberships where organization_id=org and user_id=manager and user_type='developer';
 insert into projects(id,organization_id,name,assigned_developer_id,created_by,created_by_type,manager_id,manager_type,task_plan_status,task_plan_submitted)
 values(project,org,'Delegated review',lead,lead,'developer',manager,'developer','pending',true);
 insert into developer_tasks(organization_id,project_id,developer_id,task_title,start_date,end_date)
 values(org,project,lead,'Delegated valid task',current_date,current_date);
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''developer'',''approve'')',org,project,lead),'your own task plan');
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''developer'',''approve'')',org,project,stranger),'project ownership or assigned manager required');
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''admin'',''approve'')',org,project,manager),'project ownership or assigned manager required');
 reset role;
 insert into user_permissions(membership_id,permission_key,allowed) values(member,'task.review',false);
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''developer'',''approve'')',org,project,manager),'reviewer permission required');
 reset role;
 delete from user_permissions where membership_id=member;
 update memberships set status='suspended' where id=member;
 set local role service_role;
 perform plan_review_denied(format('select commit_task_plan_review(%L,%L,%L,''developer'',''approve'')',org,project,manager),'reviewer permission required');
 reset role;
 update memberships set status='active' where id=member;
 if exists(select 1 from notifications where project_id=project) then raise exception 'Refused manager attempt emitted notice'; end if;
 if (select task_plan_status from projects where id=project)<>'pending' then raise exception 'Refused manager attempt changed verdict'; end if;
 set local role service_role;
 result:=commit_task_plan_review(org,project,manager,'developer','approve');
 reset role;
 if result->>'success'<>'true' or (result->>'notifications')::int<>1 then raise exception 'Delegated manager approval did not commit'; end if;
 if (select task_plan_reviewed_by from projects where id=project) is distinct from manager then raise exception 'Delegated reviewer attribution lost'; end if;
 if (select count(*) from notifications where project_id=project and developer_id=lead and type='task_plan_approved')<>1 then raise exception 'Delegated verdict notice incorrect'; end if;
end $$;

rollback;
