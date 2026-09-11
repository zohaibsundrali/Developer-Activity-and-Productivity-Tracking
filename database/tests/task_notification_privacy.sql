\set ON_ERROR_STOP on
\ir typed_notification_fixture.sql
\ir ../../supabase/migrations/20260911095635_production_typed_notification_recipients.sql
alter table memberships add column id uuid default gen_random_uuid(),add column role text default 'developer';
update memberships set role='admin' where user_type='admin';
create table user_permissions(membership_id uuid,permission_key text,allowed boolean,unique(membership_id,permission_key));
alter table projects add column assigned_developer_id uuid,add column task_plan_status text,add column task_plan_submitted boolean;
alter table notifications add column actor_id uuid,add column type text,add column message text,add column created_at timestamptz default now(),add column metadata jsonb,add column dismissed_at timestamptz,
 add column task_id uuid,add column project_id uuid,add column submission_id uuid,add column entity_type text,add column entity_id uuid;
create table developer_tasks(id uuid primary key,organization_id uuid,project_id uuid,developer_id uuid,task_type text,client_visible boolean);
create table task_submissions(id uuid primary key,organization_id uuid,task_id uuid,project_id uuid);
create function auth_is_client() returns boolean language sql stable as $$ select auth.jwt()->'app_metadata'->>'user_type'='client' $$;
create function auth_role() returns text language sql stable security definer as $$ select role from memberships where organization_id=auth_org() and user_id=auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and status='active' $$;
create function auth_override(k text) returns boolean language sql stable security definer as $$ select p.allowed from user_permissions p join memberships m on m.id=p.membership_id where m.organization_id=auth_org() and m.user_id=auth_app_user_id() and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and p.permission_key=k $$;
create function auth_plan_feature(k text) returns boolean language sql as $$select true$$;
create function auth_client_project_ids() returns setof uuid language sql as $$select id from projects where false$$;
create function try_uuid(v text) returns uuid language plpgsql immutable as $$ begin return v::uuid; exception when invalid_text_representation then return null; end $$;
create policy task_base on developer_tasks for select to authenticated using(organization_id=auth_org());
alter table projects enable row level security;
create policy project_base on projects for select to authenticated using(organization_id=auth_org());
alter table task_submissions enable row level security;
create policy proof_base on task_submissions for select to authenticated using(organization_id=auth_org());
grant select on memberships,projects,developer_tasks,task_submissions to authenticated;
\ir ../../supabase/migrations/20260911100211_production_task_authorization.sql
\ir ../../supabase/migrations/20260911081955_production_notification_update_guard.sql
\ir ../../supabase/migrations/20260911102420_production_notification_recipient_state.sql
\ir ../../supabase/migrations/20260911131810_production_notification_insert_authority.sql
\ir ../../supabase/migrations/20260911133207_production_task_notification_privacy.sql
create function privacy_actor(profile text,actor uuid) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('organization_id','00000000-0000-0000-0000-000000000001','user_type',profile,'app_user_id',actor))::text,false)
$$;
create function privacy_notice(recipient uuid,profile text,task uuid) returns void language sql as $$
 insert into notifications(organization_id,developer_id,admin_id,admin_recipient_type,type,title,task_id)
 values('00000000-0000-0000-0000-000000000001',case when profile='developer' then recipient end,
 case when profile='admin' then recipient::text end,case when profile='admin' then 'admin' end,'task_comment','Private title',task)
$$;
create function privacy_expect(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when insufficient_privilege then return; end; raise exception 'Expected privacy refusal'; end $$;
insert into projects(id,organization_id) values('80000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
insert into developer_tasks values('80000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','feature',false);
select privacy_actor('admin','00000000-0000-0000-0000-000000000011');
set role authenticated;
select privacy_expect($q$select privacy_notice('00000000-0000-0000-0000-000000000012','developer','80000000-0000-0000-0000-000000000002')$q$);
select privacy_notice('00000000-0000-0000-0000-000000000011','developer','80000000-0000-0000-0000-000000000002');
reset role;
select privacy_actor('developer','00000000-0000-0000-0000-000000000011');
set role authenticated;
do $$begin if (select count(*) from notification_inbox where type='task_comment')<>1 then raise exception 'Own notice missing'; end if; end$$;
reset role;
-- Revocation hides previously delivered content from both inbox and base table.
insert into user_permissions select id,'task.view_own',false from memberships where user_id='00000000-0000-0000-0000-000000000011' and user_type='developer';
set role authenticated;
do $$begin if exists(select 1 from notifications where type='task_comment') or exists(select 1 from notification_inbox where type='task_comment') then raise exception 'Revoked notice visible'; end if; end$$;
reset role;
-- Trusted delivery cannot bypass the later reader check.
set role service_role;
select privacy_notice('00000000-0000-0000-0000-000000000012','developer','80000000-0000-0000-0000-000000000002');
reset role;
select privacy_actor('developer','00000000-0000-0000-0000-000000000012');
set role authenticated;
do $$begin if exists(select 1 from notifications where type='task_comment') then raise exception 'Trusted delivery bypassed read permission'; end if; end$$;
reset role;
-- QA bug-triage override permits bugs only; role changes revoke the same notice.
insert into user_permissions select id,'bug.triage',true from memberships where user_id='00000000-0000-0000-0000-000000000012';
update developer_tasks set task_type='bug';
set role authenticated;
do $$begin if (select count(*) from notifications where type='task_comment')<>1 then raise exception 'Bug triage notice missing'; end if; end$$;
reset role;
update developer_tasks set task_type='feature';
set role authenticated;
do $$begin if exists(select 1 from notifications where type='task_comment') then raise exception 'Bug-only grant leaked feature'; end if; end$$;
reset role;
-- A no-live-reference historical removal notice survives reassignment/revocation.
insert into notifications(organization_id,developer_id,type,title,message)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','task_reassigned_away','Assignment changed','You are no longer assigned to the previous task.');
select privacy_actor('developer','00000000-0000-0000-0000-000000000011');
set role authenticated;
do $$begin if (select count(*) from notification_inbox where type='task_reassigned_away')<>1 then raise exception 'Historical snapshot lost'; end if; end$$;
reset role;
-- Integrate the real assignment trigger with the privacy policies.
alter table developer_tasks add column task_title text;
grant select,update on developer_tasks to service_role;
update developer_tasks set task_title='Previously assigned task';
\ir ../../supabase/migrations/20260911133042_production_transactional_task_assignment_notifications.sql
update user_permissions set allowed=true where permission_key='task.view_own';
select privacy_actor('admin','00000000-0000-0000-0000-000000000011');
set role service_role;
update developer_tasks set developer_id='00000000-0000-0000-0000-000000000012',task_title='New private task title'
 where id='80000000-0000-0000-0000-000000000002';
reset role;
select privacy_actor('developer','00000000-0000-0000-0000-000000000011');
set role authenticated;
do $$begin
 if exists(select 1 from notification_inbox where type='task_comment') then raise exception 'Reassigned old task content remains visible'; end if;
 if not exists(select 1 from notification_inbox where type='task_reassigned_away' and title='Task assignment removed'
   and message like '%Previously assigned task%' and message not like '%New private task title%'
   and task_id is null and project_id is null and submission_id is null and entity_id is null) then raise exception 'Safe actual assignment-away snapshot missing'; end if;
end$$;
reset role;
select privacy_actor('developer','00000000-0000-0000-0000-000000000012');
set role authenticated;
do $$begin if (select count(*) from notification_inbox where type='task_reassigned')<>1 then raise exception 'New assignment notice missing'; end if; end$$;
reset role;
insert into user_permissions select id,'task.view_own',false from memberships where user_id='00000000-0000-0000-0000-000000000012';
set role authenticated;
do $$begin if exists(select 1 from notification_inbox where type='task_reassigned') then raise exception 'Revoked current assignment notice visible'; end if; end$$;
reset role;
-- An admin profile sharing the assigned developer UUID cannot inherit own read.
insert into memberships(organization_id,user_id,user_type,email,status,role)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','admin','collision@test.dev','active','developer');
select privacy_actor('admin','00000000-0000-0000-0000-000000000011');
set role authenticated;
select privacy_expect($q$select privacy_notice('00000000-0000-0000-0000-000000000012','admin','80000000-0000-0000-0000-000000000002')$q$);
reset role;
