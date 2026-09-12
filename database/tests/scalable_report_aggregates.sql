-- Actual typed Auth, permission override and time-log guards from prior fixtures.
\ir transactional_timesheet_review.sql
alter table memberships add column if not exists email text;
alter table developers add column if not exists name text,add column if not exists email text;
alter table admin_users add column if not exists full_name text,add column if not exists email text;
alter table projects add column if not exists status text,add column if not exists progress numeric,add column if not exists deadline date,add column if not exists end_date date;
alter table developer_tasks add column if not exists status text,add column if not exists task_title text,add column if not exists due_date date,add column if not exists end_date date,add column if not exists actual_completion_date date,add column if not exists is_on_time boolean,add column if not exists productivity_points numeric,add column if not exists reviewed_at timestamptz,add column if not exists updated_at timestamptz;
alter table task_time_logs add column if not exists source text;
create table productivity_sessions(session_id text primary key,organization_id uuid,user_id varchar(100),user_email text,start_time timestamptz,total_duration numeric,productivity_score numeric);
alter table productivity_sessions enable row level security;
-- Explicit test plan switch; production helper is the established plan resolver.
create or replace function auth_plan_feature(k text) returns boolean language sql stable as $$select current_setting('test.report_plan',true) is distinct from 'denied'$$;
-- Existing retention helper runs against a fixture plan-limit resolver.
create or replace function app_private.plan_limit(uuid,text) returns bigint language sql stable as $$select coalesce(nullif(current_setting('test.history_days',true),'')::bigint,-1)$$;
\ir ../../supabase/migrations/20260912094423_production_tracking_event_history_timestamps.sql
create policy report_session_read on productivity_sessions for select to authenticated using(organization_id=auth_org() and auth_tracking_history(organization_id,to_jsonb(productivity_sessions)) and (auth_role() in ('owner','admin') or user_id::text=auth_app_user_id()::text));
grant select on productivity_sessions to authenticated;
grant select on projects,developer_tasks,memberships,developers,admin_users to authenticated;
\ir ../../supabase/migrations/20260912124428_production_scalable_report_aggregates.sql
update developers set name='Developer',email='developer@example.test' where id='99100000-0000-0000-0000-000000000011';
update admin_users set full_name='Admin' where id='99100000-0000-0000-0000-000000000011';
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
insert into projects(id,organization_id,name,status) values('99700000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000001','Large report','active');
insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,status,due_date,actual_completion_date,is_on_time,productivity_points) values
 ('99700000-0000-0000-0000-000000000011','99100000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','Done task','approved','2026-08-01','2026-08-02',false,10);
-- Historical fixture seeding is privileged; all read assertions use real JWTs.
select set_config('request.jwt.claims','{}',false);
-- Committed batches avoid building a 20,001-version quota-lock row chain.
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1000);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,task_id,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','developer','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000011','2026-08-01T10:00Z','2026-08-01T11:00Z',60 from generate_series(1,1);
insert into task_time_logs(organization_id,user_type,developer_id,project_id,started_at,ended_at,seconds) values('99100000-0000-0000-0000-000000000001','admin','99100000-0000-0000-0000-000000000011','99700000-0000-0000-0000-000000000001','2026-08-01T10:00Z','2026-08-01T11:00Z',3600);
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
insert into productivity_sessions values('report-session','99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer@example.test','2026-08-01T23:59Z',7200,50),('report-outside','99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer@example.test','2026-08-03T00:00Z',9000,90);
set role authenticated;
do $$declare r jsonb;begin
 r:=report_data('2026-08-01','2026-08-02');
 if (r->'kpis'->>'loggedHours')::numeric<>334.4 or (r->'kpis'->>'trackedHours')::numeric<>2 or (r->'totals'->>'time')::int<>20002 or (r->'totals'->>'timedHours')::numeric<>401.02 then raise exception 'Large report sum/rounding failed: %',r;end if;
 r:=report_data('2026-08-01','2026-08-02','time',500,20000);
 if jsonb_array_length(r->'rows')<>2 or (r->>'total')::int<>20002 or r->>'nextOffset' is not null then raise exception 'Pagination failed: %',r;end if;
 r:=report_data('2026-08-01','2026-08-02','team');
 if not exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'userType'='admin' and x->>'userId'='99100000-0000-0000-0000-000000000011' and (x->>'loggedHours')::numeric=1 and (x->>'trackedHours')::numeric=0) then raise exception 'Typed admin collision: %',r;end if;
end $$;
select timesheet_expect('select report_data(''2026-08-02'',''2026-08-01'')','REPORT_RANGE_INVALID');
select timesheet_expect('select report_data(''2026-08-01'',''2026-08-02'',''unknown'')','REPORT_INPUT_INVALID');
select timesheet_expect('select report_data(''2026-08-01'',''2026-08-02'',''time'',501)','REPORT_INPUT_INVALID');
select set_config('test.report_plan','denied',false);
select timesheet_expect('select report_data(''2026-08-01'',''2026-08-02'')','REPORT_PLAN_REQUIRED');
select set_config('test.report_plan','allowed',false);
select set_config('test.history_days','1',false);
do $$begin if (report_data('2026-08-01','2026-08-02')->'kpis'->>'trackedHours')::numeric<>0 then raise exception 'Expired history leaked';end if;end$$;
reset role;
insert into user_permissions(membership_id,permission_key,allowed) select id,'report.view',false from memberships where user_id='99100000-0000-0000-0000-000000000012';
set role authenticated;
select timesheet_expect('select report_data(''2026-08-01'',''2026-08-02'')','REPORT_FORBIDDEN');
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
select timesheet_expect('select report_data(''2026-08-01'',''2026-08-02'')','REPORT_FORBIDDEN');
reset role;
insert into user_permissions(membership_id,permission_key,allowed) select id,'report.view',true from memberships where user_type='developer' and user_id='99100000-0000-0000-0000-000000000011';
set role authenticated;
do $$declare r jsonb;begin r:=report_data('2026-08-01','2026-08-02');if (r->'kpis'->>'loggedHours')::numeric<>333.4 then raise exception 'Typed read scope bypass: %',r;end if;end$$;
reset role;
do $$begin if has_function_privilege('anon','report_data(date,date,text,integer,integer)','EXECUTE') or has_function_privilege('service_role','report_data(date,date,text,integer,integer)','EXECUTE') then raise exception 'Report ACL bypass';end if;end$$;
-- Rollback-isolated historical fixtures exercise stable UTC grouping and no
-- multiplication when a task/project has many logs and desktop checkpoints.
begin;
delete from user_permissions where permission_key='report.view';
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
select set_config('test.history_days','-1',true);
insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,status,due_date) values('99700000-0000-0000-0000-000000000012','99100000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','Rejected task','rejected','2026-08-01');
insert into productivity_sessions values('report-foreign','00000000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer@example.test','2026-08-01T10:00Z',999999,100);
set local timezone='Pacific/Auckland';
set local role authenticated;
do $$declare r jsonb; p jsonb;begin
 r:=report_data('2026-08-01','2026-08-02');
 if (r->'statusCounts'->>'rejected')::int<1 or (r->'kpis'->>'trackedHours')::numeric<>2 or r->'trend'->'trackedHours' <> '[2.00,0.00]'::jsonb then raise exception 'UTC or cross-tenant report drift: %',r;end if;
 select x into p from jsonb_array_elements(report_data('2026-08-01','2026-08-02','projects')->'rows') x where x->>'projectId'='99700000-0000-0000-0000-000000000001';
 if (p->>'total')::int<>2 or (p->>'done')::int<>1 or (p->>'loggedHours')::numeric<>334.35 then raise exception 'Task/log fanout or project totals: %',p;end if;
 if not exists(select 1 from jsonb_array_elements(report_data('2026-08-01','2026-08-02','delays')->'rows') x where x->>'id'='99700000-0000-0000-0000-000000000011' and x->>'state'='Completed late' and x->>'daysLate'='1') then raise exception 'Completed delay parity';end if;
end $$;
reset role;
rollback;
begin;
delete from user_permissions where permission_key='report.view';
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
select set_config('test.history_days','-1',true);
insert into productivity_sessions values('report-email-only','99100000-0000-0000-0000-000000000001',null,'developer@example.test','2026-08-04T10:00Z',3600,75);
set local role authenticated;
do $$begin if not exists(select 1 from jsonb_array_elements(report_data('2026-08-04','2026-08-04','team')->'rows') x where x->>'userType'='developer' and (x->>'trackedHours')::numeric=1) then raise exception 'Unique legacy email attribution';end if;end$$;
reset role;
insert into developers(id,organization_id,auth_user_id,name,email) values('99700000-0000-0000-0000-000000000021','99100000-0000-0000-0000-000000000001',null,'Duplicate email','developer@example.test');
insert into memberships(organization_id,user_id,user_type,role,status) values('99100000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000021','developer','developer','active');
set local role authenticated;
do $$declare r jsonb;begin
 r:=report_data('2026-08-04','2026-08-04');
 if (r->'kpis'->>'trackedHours')::numeric<>1 then raise exception 'Ambiguous session duplicated in overview';end if;
 if exists(select 1 from jsonb_array_elements(report_data('2026-08-04','2026-08-04','team')->'rows') x where (x->>'trackedHours')::numeric<>0) then raise exception 'Ambiguous email assigned to a person';end if;
end$$;
reset role;
rollback;
begin;
delete from user_permissions where permission_key='report.view';
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
set local role authenticated;
select timesheet_expect('select report_data(''0001-01-01 BC'',''0001-01-01'')','REPORT_RANGE_INVALID');
select timesheet_expect('select report_data(''9999-12-30'',''9999-12-31'')','REPORT_RANGE_INVALID');
select timesheet_expect('select report_data(''2000-01-01'',''2026-01-01'')','REPORT_RANGE_INVALID');
select timesheet_expect('select report_data(''2026-08-01'',''2026-08-02'',''time'',10,-1)','REPORT_INPUT_INVALID');
reset role;
do $$begin
 if (select prosecdef or provolatile<>'s' from pg_proc where oid='report_data(date,date,text,integer,integer)'::regprocedure) then raise exception 'Report must be stable security invoker';end if;
 if not has_function_privilege('authenticated','report_data(date,date,text,integer,integer)','EXECUTE') then raise exception 'Authenticated report grant missing';end if;
end$$;
rollback;
