-- Fresh database. Minimal typed identity scaffold; permission data is real,
-- billing/quota failures are injected so rollback can be tested without billing services.
\ir task_authorization_fixture.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
alter table memberships add column id uuid default gen_random_uuid() unique;
alter table user_permissions add column membership_id uuid;
create schema app_private;
create function app_private.lock_quota(org uuid) returns void language plpgsql as $$ begin
 if current_setting('test.quota_failure',true)='yes' then raise exception 'PLAN_LIMIT_REACHED: active_tasks'; end if;
end $$;
create function app_private.org_unlocked(org uuid) returns boolean language sql as $$ select coalesce(current_setting('test.billing_locked',true),'no')<>'yes' $$;
create table test_cases(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid references projects on delete cascade,
 title text,steps text,status text default 'active');
create table test_runs(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid references projects on delete cascade,
 name text,notes text,created_by uuid,status text default 'open');
create table test_executions(id uuid primary key default gen_random_uuid(),organization_id uuid,run_id uuid references test_runs on delete cascade,
 test_case_id uuid references test_cases,result text default 'untested',bug_task_id uuid references developer_tasks on delete set null,
 updated_at timestamptz,unique(run_id,test_case_id));
create function fail_quality_write() returns trigger language plpgsql as $$ begin
 if current_setting('test.execution_failure',true)='yes' then raise exception 'INJECTED_EXECUTION_FAILURE'; end if;
 return new;
end $$;
create trigger execution_failure before insert or update on test_executions for each row execute function fail_quality_write();
\ir ../../supabase/migrations/20260911102436_production_quality_transactions.sql
create function qa_expect(command text,expected text) returns void language plpgsql as $$ begin
 begin execute command; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
 raise exception 'Expected refusal: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); foreign_project uuid:=gen_random_uuid();
 execution uuid; run uuid; result jsonb; actor_member uuid; command text; bug_command text;
begin
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,actor,'developer','qa','active') returning id into actor_member;
 insert into projects(id,organization_id) values(project,org),(foreign_project,gen_random_uuid());
 insert into test_cases(organization_id,project_id,title,status) values(org,project,'One','active'),(org,project,'Two','active'),(org,project,'Archived','archived');
 command:=format('select create_quality_run(%L,%L,''developer'',%L,''Release'',''Notes'')',org,actor,project);
 perform set_config('test.execution_failure','yes',true);
 perform qa_expect(command,'INJECTED_EXECUTION_FAILURE');
 if exists(select 1 from test_runs) or exists(select 1 from test_executions) then raise exception 'Partial run persisted'; end if;
 perform set_config('test.execution_failure','no',true);
 perform set_config('test.billing_locked','yes',true);
 perform qa_expect(command,'BILLING_LOCKED');
 perform set_config('test.billing_locked','no',true);
 insert into user_permissions(membership_id,permission_key,allowed) values(actor_member,'test_run.manage',false);
 perform qa_expect(command,'QA_FORBIDDEN');
 delete from user_permissions;
 perform qa_expect(format('select create_quality_run(%L,%L,''admin'',%L,''Release'',null)',org,actor,project),'QA_FORBIDDEN');
 perform qa_expect(format('select create_quality_run(%L,%L,''developer'',%L,''Release'',null)',org,actor,foreign_project),'QA_NOT_FOUND');
 set local role authenticated;
 perform qa_expect(command,'permission denied');
 reset role;
 set local role service_role;
 result:=create_quality_run(org,actor,'developer',project,'Release','Notes');
 reset role;
 if (result->>'cases')::int<>2 or (select count(*) from test_executions)<>2 then raise exception 'Wrong run snapshot'; end if;
 run:=(result->'run'->>'id')::uuid;
 select id into execution from test_executions where run_id=run limit 1;
 bug_command:=format('select raise_quality_bug(%L,%L,''developer'',%L,''Description'',''major'',''Web'')',org,actor,execution);
 perform qa_expect(bug_command,'Only a failed or blocked');
 update test_executions set result='failed' where id=execution;
 perform set_config('test.execution_failure','yes',true);
 perform qa_expect(bug_command,'INJECTED_EXECUTION_FAILURE');
 if exists(select 1 from developer_tasks) or exists(select 1 from test_executions where bug_task_id is not null) then raise exception 'Orphan defect persisted'; end if;
 perform set_config('test.execution_failure','no',true);
 update test_runs set status='closed' where id=run;
 perform qa_expect(bug_command,'test run is closed');
 update test_runs set status='open' where id=run;
 perform set_config('test.quota_failure','yes',true);
 perform qa_expect(bug_command,'PLAN_LIMIT_REACHED');
 perform set_config('test.quota_failure','no',true);
 insert into user_permissions(membership_id,permission_key,allowed) values(actor_member,'bug.raise',false);
 perform qa_expect(bug_command,'QA_FORBIDDEN');
 delete from user_permissions;
 set local role service_role;
 result:=raise_quality_bug(org,actor,'developer',execution,'Description','major','Web');
 reset role;
 if (select count(*) from developer_tasks)<>1 or (select bug_task_id from test_executions where id=execution) is distinct from (result->'bug'->>'id')::uuid then raise exception 'Defect link missing'; end if;
 if result->'bug'->>'task_title'<>'Failed test: One' and result->'bug'->>'task_title'<>'Failed test: Two' then raise exception 'Wrong task title'; end if;
 perform qa_expect(bug_command,'already has a defect linked');
 if (select count(*) from developer_tasks)<>1 then raise exception 'Duplicate defect'; end if;
 insert into test_cases(organization_id,project_id,title) select org,project,'Extra' from generate_series(1,499);
 perform qa_expect(command,'at most 500');
 if (select count(*) from test_runs)<>1 then raise exception 'Oversize run persisted'; end if;
end $$;
rollback;
