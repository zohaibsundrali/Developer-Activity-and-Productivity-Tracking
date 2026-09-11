-- Fresh database: reuse actual task/project/clone guards and their schema.
\set ON_ERROR_STOP on
\ir project_clone_transaction.sql
alter table projects add column manager_id uuid,add column added_by_admin text,add column admin_id uuid;
alter table memberships add column id uuid default gen_random_uuid(),add column email text;
alter table user_permissions add column membership_id uuid;
create function app_private.org_unlocked(uuid) returns boolean language sql stable as $$ select true $$;
create table task_submissions(id uuid primary key default gen_random_uuid(),organization_id uuid,task_id uuid,project_id uuid,developer_id uuid,
 review_status text default 'pending',is_reviewed boolean default false,reviewed_by uuid,reviewed_at timestamptz,review_comments text,submitted_at timestamptz,file_url text);
create table admin_reviews(id uuid default gen_random_uuid(),organization_id uuid,admin_id uuid,admin_email text,admin_name text,task_id uuid,submission_id uuid,project_id uuid,
 developer_id uuid,review_action text,review_comments text,rejection_reason text,task_title text,submission_file_url text,deadline date,submission_date timestamptz,reviewed_at timestamptz);
create table activity_logs(organization_id uuid,developer_id uuid,project_id uuid,task_id uuid,action_type text,action_description text,old_value text,new_value text);
create table productivity_metrics(organization_id uuid,developer_id uuid,project_id uuid,total_tasks int,completed_on_time int,completed_late int,pending_tasks int,
 rejected_tasks int,productivity_percentage numeric,productivity_points int,updated_at timestamptz,unique(developer_id,project_id));
create table notifications(id uuid default gen_random_uuid(),organization_id uuid,developer_id uuid,admin_id text,admin_recipient_type text,type text,title text,message text,
 project_id uuid,task_id uuid,submission_id uuid,read boolean);
insert into memberships(organization_id,user_id,user_type,role,status,email) values
 ('74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000011','admin','owner','active','admin@example.test'),
 ('74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000011','developer','qa','active','developer@example.test'),
 ('74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000012','developer','manager','active','manager@example.test');
insert into projects(id,organization_id,created_by,added_by,manager_id) values
 ('74000000-0000-0000-0000-000000000101','74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000011',null,'74000000-0000-0000-0000-000000000011'),
 ('74000000-0000-0000-0000-000000000102','74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000012',null,'74000000-0000-0000-0000-000000000012');
create table organizations(id uuid primary key);
insert into organizations select distinct organization_id from projects;
-- Reproduce deployed locked subscriptions with the actual billing trigger.
create or replace function app_private.org_unlocked(uuid) returns boolean language sql stable as $$ select false $$;
\ir ../../supabase/migrations/20260911083056_production_delivery_write_lock.sql
\ir ../../supabase/migrations/20260911113526_production_typed_project_ownership.sql
do $$ begin
 if (select tgenabled from pg_trigger where tgrelid='public.projects'::regclass and tgname='delivery_write_lock')<>'O' then
  raise exception 'Backfill did not restore billing enforcement'; end if;
 begin
  update public.projects set name='Must remain locked' where id='74000000-0000-0000-0000-000000000102';
  raise exception 'Billing lock bypassed after migration' using errcode='XX000';
 exception when sqlstate 'P0001' then
  if sqlerrm not like 'BILLING_LOCKED:%' then raise; end if;
 end;
end $$;
create or replace function app_private.org_unlocked(uuid) returns boolean language sql stable as $$ select true $$;

do $$ declare org uuid:='74000000-0000-0000-0000-000000000001'; collision uuid:='74000000-0000-0000-0000-000000000011';
 manager uuid:='74000000-0000-0000-0000-000000000012'; project uuid:='74000000-0000-0000-0000-000000000101';
 task uuid; submission uuid; result jsonb; cloned uuid; begin
 if (select created_by_type from projects where id=project) is not null then raise exception 'Ambiguous creator backfilled'; end if;
 if (select created_by_type from projects where id='74000000-0000-0000-0000-000000000102')<>'developer' then raise exception 'Unique creator not backfilled'; end if;
 if project_actor_is_owner(org,project,collision,'admin',false) or project_actor_is_owner(org,project,collision,'developer',false) then raise exception 'Untyped ambiguity granted ownership'; end if;
 update projects set created_by_type='admin',manager_type='admin' where id=project;
 if not project_actor_is_owner(org,project,collision,'admin',false) or project_actor_is_owner(org,project,collision,'developer',false) then raise exception 'Typed creator identity ignored'; end if;
 if not project_actor_is_manager(org,project,collision,'admin') or project_actor_is_manager(org,project,collision,'developer') then raise exception 'Typed manager identity ignored'; end if;
 insert into developer_tasks(organization_id,project_id,developer_id,status,task_title,end_date)
 values(org,project,collision,'awaiting_approval','Proof','2026-09-11') returning id into task;
 insert into task_submissions(organization_id,task_id,project_id,developer_id,submitted_at)
 values(org,task,project,collision,'2026-09-11 12:00Z') returning id into submission;
 if not task_watcher_reviewer_eligible(org,task,collision,'admin') or task_watcher_reviewer_eligible(org,task,collision,'developer') then raise exception 'Watcher typed self-review incorrect'; end if;
 result:=commit_task_review(org,collision,'admin','admin@example.test',task,submission,'approve',null,null);
 if result->'task'->>'status'<>'completed' then raise exception 'Independent admin blocked as own work'; end if;
 if (select admin_recipient_type from notifications limit 1)<>'admin' then raise exception 'Review notification omitted profile type'; end if;
 -- Legacy email fallback is opt-in and unique, never a broad OR identity guess.
 update projects set created_by=null,created_by_type=null,manager_id=null,manager_type=null,added_by_admin='MANAGER@example.test' where id=project;
 if project_actor_is_owner(org,project,manager,'developer',false) or not project_actor_is_owner(org,project,manager,'developer',true) then raise exception 'Legacy email fallback incorrect'; end if;
 -- A browser cannot name somebody else as its creator or supply manager authority.
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',manager,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 insert into projects(id,organization_id,created_by,added_by,created_by_type,added_by_type,name,admin_id)
 values('74000000-0000-0000-0000-000000000103',org,collision,collision,'admin','admin','Owned by cloner',collision);
 begin
  update projects set admin_id=collision where id='74000000-0000-0000-0000-000000000103';
  raise exception 'Legacy alternate owner forged';
 exception when insufficient_privilege then null; end;
 reset role;
 if not exists(select 1 from projects where id='74000000-0000-0000-0000-000000000103' and created_by=manager and added_by=manager and created_by_type='developer' and added_by_type='developer' and admin_id is null) then raise exception 'Browser attribution not stamped'; end if;
 update projects set manager_id=collision,manager_type='admin' where id='74000000-0000-0000-0000-000000000103';
 set local role authenticated;
 result:=clone_project('74000000-0000-0000-0000-000000000103','Typed clone',false);
 reset role;
 cloned:=(result->'project'->>'id')::uuid;
 if not exists(select 1 from projects where id=cloned and created_by=manager and created_by_type='developer' and manager_id is null and manager_type is null) then raise exception 'Clone retained unauthorized manager or wrong creator'; end if;
 -- Known-admin creator copied by owner is replaced by independently verified creator.
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',collision,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated;
 result:=clone_project('74000000-0000-0000-0000-000000000103','Admin clone',false);
 reset role;
 if result->'project'->>'created_by_type'<>'admin' or result->'project'->>'manager_type'<>'admin' then raise exception 'Authorized clone lost typed ownership'; end if;
end $$;

-- A self-assigned creator can obtain an independent review through the existing
-- typed project-manager delegation, without opening review to the whole org.
do $$ declare org uuid:='74000000-0000-0000-0000-000000000001'; lead uuid:='74000000-0000-0000-0000-000000000012';
 reviewer uuid:='74000000-0000-0000-0000-000000000013'; outsider uuid:='74000000-0000-0000-0000-000000000011';
 project uuid:='74000000-0000-0000-0000-000000000104'; task uuid; proof uuid; result jsonb;
begin
 update memberships set role='team_lead' where user_id=lead and user_type='developer';
 insert into memberships(organization_id,user_id,user_type,role,status,email) values
  (org,reviewer,'developer','manager','active','delegated@example.test'),
  (org,reviewer,'admin','admin','active','other-profile@example.test');
 insert into projects(id,organization_id,created_by,created_by_type,added_by,added_by_type,assigned_developer_id,manager_id,manager_type,name)
 values(project,org,lead,'developer',lead,'developer',lead,reviewer,'developer','Self-assigned creator');
 insert into developer_tasks(organization_id,project_id,developer_id,status,task_title,end_date)
 values(org,project,lead,'awaiting_approval','Delegated review','2026-09-11') returning id into task;
 insert into task_submissions(organization_id,task_id,project_id,developer_id,submitted_at)
 values(org,task,project,lead,'2026-09-11 12:00Z') returning id into proof;
 if not project_actor_can_review(org,project,reviewer,'developer',false)
  or project_actor_can_review(org,project,reviewer,'admin',false)
  or project_actor_can_review(org,project,outsider,'admin',false) then raise exception 'Delegation not scoped to typed manager'; end if;
 if not task_watcher_reviewer_eligible(org,task,reviewer,'developer') then raise exception 'Delegated manager missing from reviewer eligibility'; end if;
 begin
  perform commit_task_review(org,lead,'developer','manager@example.test',task,proof,'approve',null,null);
  raise exception 'Creator reviewed own work';
 exception when insufficient_privilege then null; end;
 begin
  perform commit_task_review(org,outsider,'admin','admin@example.test',task,proof,'approve',null,null);
  raise exception 'Unrelated org owner reviewed delegated project';
 exception when insufficient_privilege then null; end;
 begin
  perform commit_task_review(org,reviewer,'admin','other-profile@example.test',task,proof,'approve',null,null);
  raise exception 'Colliding admin profile used developer manager delegation';
 exception when insufficient_privilege then null; end;
 insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id)
  select user_id,user_type,'task.review',false,id from memberships where user_id=reviewer and user_type='developer';
 begin
  perform commit_task_review(org,reviewer,'developer','delegated@example.test',task,proof,'approve',null,null);
  raise exception 'Delegation bypassed explicit review denial';
 exception when insufficient_privilege then null; end;
 delete from user_permissions where user_id=reviewer and user_type='developer';
 update memberships set status='suspended' where user_id=reviewer and user_type='developer';
 begin
  perform commit_task_review(org,reviewer,'developer','delegated@example.test',task,proof,'approve',null,null);
  raise exception 'Suspended manager reviewed work';
 exception when insufficient_privilege then null; end;
 update memberships set status='active' where user_id=reviewer and user_type='developer';
 result:=commit_task_review(org,reviewer,'developer','delegated@example.test',task,proof,'approve','Independent review',null);
 if result->'task'->>'status'<>'completed' or (select review_status from task_submissions where id=proof)<>'approved' then
  raise exception 'Delegated proof review failed'; end if;
end $$;
