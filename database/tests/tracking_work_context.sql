-- Isolated PostgreSQL fixture; actual device + task access helpers are applied.
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
\ir quota_fixture.sql
create schema storage;
create table storage.objects(bucket_id text,name text);
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create function public.auth_app_user_id() returns uuid language sql stable as $$select (auth.jwt()->'app_metadata'->>'app_user_id')::uuid$$;
create function public.auth_role() returns text language sql stable as $$select auth.jwt()->'app_metadata'->>'role'$$;
create function public.auth_override(k text) returns boolean language sql stable as $$select (auth.jwt()->'app_metadata'->'overrides'->>k)::boolean$$;
create function public.auth_is_client() returns boolean language sql stable as $$select auth.jwt()->'app_metadata'->>'user_type'='client'$$;
create function public.auth_plan_feature(text) returns boolean language sql stable as $$select true$$;
create function public.auth_client_project_ids() returns setof uuid language sql stable as $$ select null::uuid where false $$;
create function public.auth_task_plan_edit(uuid) returns boolean language sql stable as $$select false$$;
create function public.auth_task_project_valid(uuid,uuid) returns boolean language sql stable as $$select true$$;
alter table projects add column status text default 'active',add column archived boolean default false,add column is_template boolean default false,add column assigned_to uuid;
alter table developer_tasks add column developer_id uuid,add column project_id uuid,add column task_title text,add column task_type text default 'task',add column client_visible boolean default false;
create table project_members(project_id uuid,organization_id uuid,user_id uuid,user_type text);
create table productivity_sessions(session_id uuid primary key,organization_id uuid,user_id uuid,user_email text,end_time timestamptz);
grant select,insert,update,delete on project_members,productivity_sessions to authenticated;
alter table projects enable row level security;
alter table developer_tasks enable row level security;
alter table productivity_sessions enable row level security;
create policy project_read on projects for select to authenticated using(organization_id=auth_org());
\ir ../../supabase/migrations/20260911105140_production_task_visibility_permission.sql
create policy task_read on developer_tasks for select to authenticated using(auth_task_access(organization_id,project_id,developer_id,task_type,client_visible,'read'));
\ir ../../supabase/migrations/20260911062805_production_device_sessions.sql
create policy session_write on productivity_sessions for all to authenticated using(auth_tracker_row(to_jsonb(productivity_sessions))) with check(auth_tracker_row(to_jsonb(productivity_sessions)));
\ir ../../supabase/migrations/20260912075706_production_tracking_work_context.sql
insert into developers(id,organization_id) values('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002');
insert into projects(id,organization_id,name) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Roster'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Assigned task only'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Other tenant'),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','Not assigned');
insert into project_members values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012','developer');
-- Same UUID in an admin roster is not this developer membership.
insert into project_members values('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012','admin');
insert into developer_tasks(id,organization_id,developer_id,project_id,task_title,status) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','Mine','in_progress'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','Other','pending');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000032","email":"dev@example.test","session_id":"00000000-0000-0000-0000-000000000022","app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"00000000-0000-0000-0000-000000000012","user_type":"developer","role":"developer"}}',false);
set role authenticated;
select enroll_tracker_device('test','test');
do $$ declare opts jsonb; begin
 opts:=get_tracking_work_options();
 if jsonb_array_length(opts->'projects')<>2 or jsonb_array_length(opts->'tasks')<>1 then raise exception 'Options leak/missing %',opts; end if;
end $$;
do $$ declare claims jsonb:=auth.jwt(); opts jsonb; begin
 perform set_config('request.jwt.claims',jsonb_set(claims,'{app_metadata,overrides}','{"task.view_own":false}')::text,true);
 opts:=get_tracking_work_options();
 if jsonb_array_length(opts->'projects')<>1 or jsonb_array_length(opts->'tasks')<>0 then raise exception 'Explicit permission deny ignored'; end if;
 perform set_config('request.jwt.claims',jsonb_set(claims,'{app_metadata,user_type}','"client"')::text,true);
 perform expect_rejected('select get_tracking_work_options()','TRACKING_DEVICE_REQUIRED');
 perform set_config('request.jwt.claims',claims::text,true);
end $$;
reset role;
create function public.test_tracking_insert(p uuid,t uuid) returns void language sql as $$
 insert into productivity_sessions(session_id,organization_id,user_id,user_email,project_id,task_id)
 values(gen_random_uuid(),auth_org(),auth_app_user_id(),'dev@example.test',p,t) $$;
set role authenticated;
select test_tracking_insert(null,null);
select test_tracking_insert('10000000-0000-0000-0000-000000000001',null);
select test_tracking_insert('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
select expect_rejected('select test_tracking_insert(''10000000-0000-0000-0000-000000000003'',null)','TRACKING_PROJECT_FORBIDDEN');
select expect_rejected('select test_tracking_insert(''10000000-0000-0000-0000-000000000004'',null)','TRACKING_PROJECT_FORBIDDEN');
select expect_rejected('select test_tracking_insert(''10000000-0000-0000-0000-000000000001'',''20000000-0000-0000-0000-000000000001'')','TRACKING_TASK_FORBIDDEN');
select expect_rejected('select test_tracking_insert(''10000000-0000-0000-0000-000000000001'',''20000000-0000-0000-0000-000000000002'')','TRACKING_TASK_FORBIDDEN');
select expect_rejected('update productivity_sessions set task_id=null where task_id is not null','TRACKING_CONTEXT_IMMUTABLE');
reset role;
update developer_tasks set developer_id=null,status='completed';
update projects set archived=true;
set role authenticated;
select expect_rejected('select test_tracking_insert(''10000000-0000-0000-0000-000000000002'',null)','TRACKING_PROJECT_FORBIDDEN');
-- Checkpoints preserve old attribution even when no longer selectable.
insert into productivity_sessions select session_id,organization_id,user_id,user_email,now(),project_id,task_id from productivity_sessions
 on conflict(session_id) do update set end_time=excluded.end_time,project_id=excluded.project_id,task_id=excluded.task_id;
reset role;
delete from projects;
set role authenticated;
update productivity_sessions set end_time=now();
insert into productivity_sessions select * from productivity_sessions on conflict(session_id) do update set end_time=excluded.end_time;
select revoke_tracker_device((select id from tracker_devices limit 1));
select expect_rejected('select get_tracking_work_options()','TRACKING_DEVICE_REQUIRED');
reset role;
do $$ begin if has_function_privilege('anon','get_tracking_work_options()','EXECUTE') then raise exception 'Anon grant'; end if; end $$;
