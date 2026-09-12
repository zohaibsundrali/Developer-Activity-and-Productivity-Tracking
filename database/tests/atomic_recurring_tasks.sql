\set ON_ERROR_STOP on
\ir task_assignment_notifications.sql
create schema app_private;
-- Focused plan/tenant controls; assignment + recipient guards below are real.
create function app_private.organization_deleting(uuid) returns boolean language sql stable as $$ select current_setting('test.recurring_deleting',true)='yes' $$;
create function app_private.lock_quota(uuid) returns void language sql as $$ select pg_advisory_xact_lock(hashtextextended($1::text,0)) $$;
create function app_private.org_unlocked(uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.recurring_locked',true),'no')<>'yes' $$;
create function app_private.plan_feature(uuid,text) returns boolean language sql stable as $$ select coalesce(current_setting('test.recurring_plan',true),'yes')<>'no' $$;
create table developers(id uuid primary key,organization_id uuid);
alter table developer_tasks alter column id set default gen_random_uuid();
alter table developer_tasks add column task_description text,add column status text default 'pending',add column is_recurring boolean default false,
 add column recurrence jsonb default '{}',add column due_date date,add column start_date date,add column end_date date,
 add column actual_hours numeric default 0,add column reviewed_by uuid,add column reviewed_at timestamptz,add column created_at timestamptz default now();
create table pm_activity(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid,entity_type text,entity_id uuid,action text,meta jsonb);
\ir ../../supabase/migrations/20260911083056_production_delivery_write_lock.sql
\ir ../../supabase/migrations/20260912044800_production_atomic_recurring_tasks.sql
create function recurring_inject_failure() returns trigger language plpgsql as $$ begin
 if current_setting('test.recurring_failure',true)=tg_argv[0] then raise exception 'INJECTED_RECURRING_FAILURE' using errcode='23514'; end if; return new; end $$;
create trigger recurring_child_failure before insert on developer_tasks for each row execute function recurring_inject_failure('child');
create trigger recurring_cursor_failure before update of recurrence on developer_tasks for each row execute function recurring_inject_failure('cursor');
create trigger recurring_activity_failure before insert on pm_activity for each row execute function recurring_inject_failure('activity');

do $$ declare org uuid:='99100000-0000-0000-0000-000000000001'; profile uuid:='99100000-0000-0000-0000-000000000011';
 project uuid:='99100000-0000-0000-0000-000000000101'; template uuid:='99100000-0000-0000-0000-000000000201';
 rec jsonb:='{"freq":"monthly","interval":1}'; result jsonb; tasks_before int; notices_before int; stage text; invalid jsonb;
begin
 insert into organizations(id) values(org);
 insert into developers values(profile,org);
 insert into memberships(organization_id,user_id,user_type,email,status,role) values(org,profile,'developer','recurring@test.dev','active','developer');
 insert into projects(id,organization_id) values(project,org);
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,status,is_recurring,recurrence,due_date,start_date,end_date,actual_hours,reviewed_at)
 values(template,org,project,profile,'Recurring report','completed',true,rec,'2024-01-31','2024-01-01','2024-01-31',99,now());
 select count(*) into tasks_before from developer_tasks;
 select count(*) into notices_before from notifications;
 if app_private.recurring_next_date('2024-01-01','{"freq":"daily","interval":1.0}')<>'2024-01-02' then raise exception 'Integer-valued JSON number refused'; end if;
 if app_private.recurring_next_date('2024-01-31',rec)<>'2024-03-02' or app_private.recurring_next_date('2025-01-31',rec)<>'2025-03-03' then raise exception 'Monthly overflow changed'; end if;
 foreach invalid in array array['{"freq":"unknown","interval":1}'::jsonb,'{"freq":"daily","interval":0}','{"freq":"daily","interval":1.5}','{"freq":"daily","interval":3651}','{"freq":"daily","interval":null}'] loop
  begin perform app_private.recurring_next_date('2024-01-01',invalid); raise exception 'Invalid recurrence accepted'; exception when invalid_parameter_value then null; end;
 end loop;
 set local role authenticated;
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Authenticated caller spawned recurring task'; exception when insufficient_privilege then null; end;
 reset role;
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-02-29'); raise exception 'False next date accepted'; exception when invalid_parameter_value then null; end;
 foreach stage in array array['child','cursor','activity'] loop
  perform set_config('test.recurring_failure',stage,true);
  begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Failure not propagated'; exception when check_violation then null; end;
  if (select count(*) from developer_tasks)<>tasks_before or (select count(*) from notifications)<>notices_before or exists(select 1 from pm_activity) or (select recurrence from developer_tasks where id=template)<>rec then raise exception 'Partial transaction survived % failure',stage; end if;
 end loop;
 perform set_config('test.recurring_failure','',true);
 perform set_config('test.assignment_fail','yes',true);
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Notification failure ignored'; exception when raise_exception then if sqlerrm<>'INJECTED_NOTICE_FAILURE' then raise; end if; end;
 perform set_config('test.assignment_fail','',true);
 if (select count(*) from developer_tasks)<>tasks_before or (select recurrence from developer_tasks where id=template)<>rec then raise exception 'Notice failure retained partial task'; end if;
 perform set_config('test.recurring_plan','no',true);
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Missing plan accepted'; exception when insufficient_privilege then null; end;
 perform set_config('test.recurring_plan','yes',true);
 perform set_config('test.recurring_locked','yes',true);
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Billing lock accepted'; exception when insufficient_privilege then null; end;
 perform set_config('test.recurring_locked','no',true);
 perform set_config('test.recurring_deleting','yes',true);
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Deleting org accepted'; exception when insufficient_privilege then null; end;
 perform set_config('test.recurring_deleting','no',true);
 update projects set organization_id='00000000-0000-0000-0000-000000000001' where id=project;
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Foreign project accepted'; exception when insufficient_privilege then null; end;
 update projects set organization_id=org where id=project;
 update memberships set status='suspended' where organization_id=org;
 begin perform public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02'); raise exception 'Suspended assignee accepted'; exception when insufficient_privilege then null; end;
 update memberships set status='active' where organization_id=org;
 set local role service_role;
 result:=public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02');
 reset role;
 if result->>'spawned'<>'true' or (select count(*) from developer_tasks)<>tasks_before+1 or (select count(*) from notifications)<>notices_before+1 then raise exception 'Task or assignment notice missing'; end if;
 if not exists(select 1 from notification_recipients where notification_id=(select id from notifications where task_id=(result->>'taskId')::uuid) and user_id=profile and user_type='developer') then raise exception 'Typed recipient missing'; end if;
 if not exists(select 1 from developer_tasks where id=(result->>'taskId')::uuid and status='pending' and is_recurring=false and recurrence='{}' and actual_hours=0 and reviewed_at is null and due_date='2024-03-02') then raise exception 'Child retained completion state or lost schedule'; end if;
 result:=public.spawn_recurring_task(template,rec,'2024-01-31','2024-03-02');
 if result->>'spawned'<>'false' or (select count(*) from developer_tasks)<>tasks_before+1 then raise exception 'Stale snapshot duplicated occurrence'; end if;
 -- A separate untouched template remains due for the concurrency test.
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,is_recurring,recurrence,due_date,start_date,end_date)
 values('99100000-0000-0000-0000-000000000202',org,project,profile,'Concurrent report',true,rec,'2024-01-31','2024-01-01','2024-01-31');
end $$;
select 'Atomic recurring task SQL passed' as result;
