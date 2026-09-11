\set ON_ERROR_STOP on
\ir task_relationship_integrity.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
alter role service_role bypassrls;
create schema private;
create table organizations(id uuid primary key);
create table automation_rules(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid,name text,enabled boolean default true,trigger jsonb,actions jsonb,created_by uuid,created_at timestamptz default now());
alter table automation_rules enable row level security;
create policy legacy_rules on automation_rules for all to authenticated using(organization_id=auth_org()) with check(organization_id=auth_org());
grant all on automation_rules to authenticated,service_role;
alter table developer_tasks add column labels text[];
create function try_uuid(v text) returns uuid language plpgsql immutable as $$ begin return v::uuid; exception when invalid_text_representation then return null; end $$;
create function app_private.plan_feature(uuid,text) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.automation_plan',true),''),'yes')='yes' $$;
create or replace function auth_plan_feature(k text) returns boolean language sql stable as $$ select app_private.plan_feature(auth_org(),$1) $$;
grant usage on schema app_private to authenticated;
\ir ../../supabase/migrations/20260911163247_production_durable_actor_automation_jobs.sql
-- Real assignment and status notice triggers coexist with invoker automation.
-- Additional schema fields mirror their production dependencies; core task RLS
-- above remains the actual task authorization migration.
alter table memberships add column id uuid default gen_random_uuid();
alter table user_permissions add column membership_id uuid;
alter table projects add column name text,add column assigned_to uuid;
create table notifications(id uuid primary key default gen_random_uuid(),organization_id uuid,developer_id uuid,admin_id text,admin_recipient_type text,
 type text,category text,title text,message text,task_id uuid,project_id uuid,actor_id uuid,actor_type text,metadata jsonb,entity_type text,entity_id uuid,read boolean);
create table milestones(id uuid primary key,organization_id uuid,project_id uuid,title text,status text);
-- Milestone ownership is irrelevant to this task-status integration; its real
-- typed owner/manager behavior has a separate work_transition_notices fixture.
create function project_actor_is_owner(uuid,uuid,uuid,text,boolean default false) returns boolean language sql as $$ select false $$;
create function project_actor_is_manager(uuid,uuid,uuid,text) returns boolean language sql as $$ select false $$;
\ir ../../supabase/migrations/20260911133042_production_transactional_task_assignment_notifications.sql
\ir ../../supabase/migrations/20260911170307_production_atomic_work_transition_notices.sql
insert into organizations values('80000000-0000-0000-0000-000000000001');
insert into memberships values
 ('80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000011','developer','developer','active'),
 ('80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000012','admin','owner','active');
insert into projects(id,organization_id) values('80000000-0000-0000-0000-000000000101','80000000-0000-0000-0000-000000000001');
insert into automation_rules(organization_id,name,trigger,actions) values
 ('80000000-0000-0000-0000-000000000001','Create priority','{"event":"task_created"}','[{"type":"set_priority","priority":"high"}]'),
 ('80000000-0000-0000-0000-000000000001','Do not loop','{"event":"priority_changed"}','[{"type":"set_priority","priority":"urgent"}]');
do $$ declare org uuid:='80000000-0000-0000-0000-000000000001'; actor uuid:='80000000-0000-0000-0000-000000000012'; task uuid:='80000000-0000-0000-0000-000000000201';
 job jsonb; result jsonb; before_count bigint;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated;
 insert into developer_tasks(id,organization_id,project_id,task_title,developer_id,priority) values(task,org,'80000000-0000-0000-0000-000000000101','Durable task','80000000-0000-0000-0000-000000000011','medium');
 reset role;
 if (select count(*) from automation_jobs)<>1 then raise exception 'Actual event was not durably captured'; end if;
 job:=claim_actor_automation_job(org,actor,'admin',false);
 if job is null then raise exception 'Job was not claimed'; end if;
 set local role authenticated;
 result:=apply_actor_automation_action((job->>'id')::uuid,(job->>'lease')::uuid);
 reset role;
 if result->>'priority'<>'high' or (select count(*) from automation_jobs)<>1 then raise exception 'Action failed or retriggered loop'; end if;
 -- Retry after committed task action but lost progress is idempotent.
 set local role authenticated;
 perform apply_actor_automation_action((job->>'id')::uuid,(job->>'lease')::uuid);
 reset role;
 if (select count(*) from automation_jobs)<>1 then raise exception 'Retry generated recursive job'; end if;
 -- Execute a real status action while both capture and status-notice triggers run.
 update automation_jobs set actions='[{"type":"set_status","status":"in_progress"}]' where id=(job->>'id')::uuid;
 set local role authenticated;
 perform apply_actor_automation_action((job->>'id')::uuid,(job->>'lease')::uuid);
 perform apply_actor_automation_action((job->>'id')::uuid,(job->>'lease')::uuid);
 reset role;
 if (select status from developer_tasks where id=task)<>'in_progress'
  or (select count(*) from notifications where task_id=task and type='task_status_changed')<>1
  or (select count(*) from automation_jobs)<>1 then raise exception 'Status action/notice retry integration failed'; end if;
 -- The worker cannot evade a newly applied permission denial.
 insert into user_permissions values(actor,'admin','task.manage',false);
 set local role authenticated;
 begin perform apply_actor_automation_action((job->>'id')::uuid,(job->>'lease')::uuid); raise exception 'Permission revoke bypassed'; exception when insufficient_privilege then null; end;
 reset role;
 if (select status from developer_tasks where id=task)<>'in_progress'
  or (select count(*) from notifications where task_id=task and type='task_status_changed')<>1 then raise exception 'Denied actor changed status or delivered notice'; end if;
 delete from user_permissions;
 -- Wrong typed actor cannot execute another profile job, even a colliding UUID.
 insert into memberships values(org,actor,'developer','developer','active');
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 begin perform apply_actor_automation_action((job->>'id')::uuid,(job->>'lease')::uuid); raise exception 'Typed actor isolation bypassed'; exception when insufficient_privilege then null; end;
 begin insert into automation_rules(organization_id,name,trigger,actions) values(org,'Unauthorized rule','{}','[]'); raise exception 'Rule author permission bypassed'; exception when insufficient_privilege then null; end;
 reset role;
 -- Recovery never automatically resends externally-started email work.
 update automation_jobs set external_started=true,lease_until=now()-interval '1 minute' where id=(job->>'id')::uuid;
 if claim_actor_automation_job(org,actor,'admin',true) is not null then raise exception 'Unknown email automatically retried'; end if;
 if (select status from automation_jobs where id=(job->>'id')::uuid)<>'delivery_unknown' then raise exception 'Unknown delivery not persisted'; end if;
 -- Free/locked plan cannot claim work or generate new paid automation jobs.
 perform set_config('test.automation_plan','no',true);
 if claim_actor_automation_job(org,actor,'admin',false) is not null then raise exception 'Plan gate bypassed'; end if;
 select count(*) into before_count from automation_jobs;
 insert into developer_tasks(id,organization_id,project_id,task_title) values('80000000-0000-0000-0000-000000000202',org,'80000000-0000-0000-0000-000000000101','No automation plan');
 if (select count(*) from automation_jobs)<>before_count then raise exception 'Plan gate failed event capture'; end if;
end $$;
-- Scope and review-only state are rechecked inside the invoker mutation RPC.
do $$ declare org uuid:='80000000-0000-0000-0000-000000000001'; actor uuid:='80000000-0000-0000-0000-000000000012'; job automation_jobs%rowtype; rule uuid; begin
 perform set_config('test.automation_plan','yes',true);
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 update automation_jobs set status='processing',external_started=false,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' where actor_type='admin' returning * into job;
 update automation_jobs set actions='[{"type":"add_label","label":"durable"}]' where id=job.id;
 set local role authenticated;
 perform apply_actor_automation_action(job.id,job.lease);
 perform apply_actor_automation_action(job.id,job.lease);
 reset role;
 if (select labels from developer_tasks where id=job.task_id)<>array['durable'] then raise exception 'Label retry duplicated data'; end if;
 update automation_jobs set actions='[{"type":"set_status","status":"completed"}]' where id=job.id;
 set local role authenticated;
 begin perform apply_actor_automation_action(job.id,job.lease); raise exception 'Review-only status bypassed'; exception when invalid_parameter_value then null; end;
 reset role;
 insert into projects(id,organization_id) values('80000000-0000-0000-0000-000000000103',org);
 insert into automation_rules(organization_id,project_id,name,trigger,actions) values(org,'80000000-0000-0000-0000-000000000103','Other project','{}','[]') returning id into rule;
 update automation_jobs set rule_id=rule where id=job.id;
 set local role authenticated;
 begin perform apply_actor_automation_action(job.id,job.lease); raise exception 'Project rule scope bypassed'; exception when serialization_failure then null; end;
 reset role;
end $$;
do $$ declare org uuid:='80000000-0000-0000-0000-000000000001'; actor uuid:='80000000-0000-0000-0000-000000000012'; job automation_jobs%rowtype; n bigint; begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 select * into strict job from automation_jobs where actor_type='admin' limit 1;
 select count(*) into n from automation_jobs;
 -- Knowing one's processing-job UUID does not suppress arbitrary task changes.
 set local role authenticated;
 perform set_config('app.automation_job',job.id::text,true);
 update developer_tasks set priority='urgent' where id=job.task_id;
 perform set_config('app.automation_job','',true);
 reset role;
 if (select count(*) from automation_jobs)<>n+1 then raise exception 'Forged job context suppressed unrelated event'; end if;
 insert into user_permissions values(actor,'admin','task.view_all',false),(actor,'admin','task.review',false);
 set local role authenticated;
 if exists(select 1 from automation_jobs) then raise exception 'Revoked task visibility exposed retained job snapshots'; end if;
 reset role;
end $$;
