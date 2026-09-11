-- Fresh database; use actual QA schema, legacy policies and closed-run trigger.
\ir task_authorization_fixture.sql
create table organizations(id uuid primary key);
create function auth_org_unlocked() returns boolean language sql as $$ select true $$;
\ir ../081_qa_test_management.sql
\ir ../095_staff_test_visibility.sql
grant select,insert,update,delete on test_cases,test_runs,test_executions to authenticated,service_role;
\ir ../../supabase/migrations/20260911104941_production_quality_authority.sql
create function quality_login(p_org uuid,p_actor uuid,p_type text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',p_org,'user',p_actor,'type',p_type,
  'app_metadata',jsonb_build_object('user_type',p_type))::text,true);
end $$;
create function quality_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when insufficient_privilege then return; end;
 raise exception 'Expected QA write refusal: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); project uuid:=gen_random_uuid();
 case_id uuid:=gen_random_uuid(); run_id uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid();
 role_name text; tbl text; changed int; row_count int;
begin
 insert into organizations values(org);
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,actor,'developer','qa','active');
 insert into projects(id,organization_id) values(project,org);
 insert into test_cases(id,organization_id,project_id,title) values(case_id,org,project,'Case');
 insert into test_runs(id,organization_id,project_id,name) values(run_id,org,project,'Run');
 insert into test_executions(id,organization_id,run_id,test_case_id) values(execution,org,run_id,case_id);
 perform quality_login(org,actor,'developer');
 foreach role_name in array array['owner','admin','manager','team_lead','qa','developer','designer','devops','employee'] loop
  update memberships set role=role_name where user_id=actor;
  set local role authenticated;
  foreach tbl in array array['test_cases','test_runs','test_executions'] loop
   execute format('select count(*) from %I',tbl) into row_count;
   if row_count<>1 then raise exception 'QA read lost for % on %',role_name,tbl; end if;
   execute format('update %I set organization_id=organization_id',tbl);
   get diagnostics changed=row_count;
   if changed<>0 then raise exception 'Direct update permitted for % on %',role_name,tbl; end if;
   execute format('delete from %I',tbl);
   get diagnostics changed=row_count;
   if changed<>0 then raise exception 'Direct delete permitted for % on %',role_name,tbl; end if;
  end loop;
  perform quality_denied(format('insert into test_cases(organization_id,project_id,title) values(%L,%L,''Forged'')',org,project));
  perform quality_denied(format('insert into test_runs(organization_id,project_id,name) values(%L,%L,''Forged'')',org,project));
  perform quality_denied(format('insert into test_executions(organization_id,run_id,test_case_id) values(%L,%L,%L)',org,run_id,case_id));
  reset role;
 end loop;
 -- A FOR ALL manager grant must not override an explicit SELECT denial.
 update memberships set role='owner' where user_id=actor;
 insert into user_permissions(user_id,user_type,permission_key,allowed) values(actor,'developer','test_case.view',false);
 set local role authenticated;
 foreach tbl in array array['test_cases','test_runs','test_executions'] loop
  execute format('select count(*) from %I',tbl) into row_count;
  if row_count<>0 then raise exception 'Explicit read deny bypassed on %',tbl; end if;
 end loop;
 reset role;
 -- Explicit read grants still work for HR, without granting mutation rights.
 update memberships set role='hr' where user_id=actor;
 update user_permissions set allowed=true;
 set local role authenticated;
 if (select count(*) from test_cases)<>1 then raise exception 'Read grant lost'; end if;
 update test_executions set executed_by=gen_random_uuid(),executed_at=now(),result='passed' where id=execution;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Execution attribution forged'; end if;
 reset role;
 update memberships set status='suspended' where user_id=actor;
 set local role authenticated;
 if exists(select 1 from test_cases) then raise exception 'Suspended read accepted'; end if;
 reset role;
 update memberships set status='active',user_type='client',role='owner' where user_id=actor;
 perform quality_login(org,actor,'client');
 set local role authenticated;
 if exists(select 1 from test_cases) then raise exception 'Client role spoof accepted'; end if;
 reset role;
 -- Trusted API writes work; real schema closes execution mutations afterward.
 alter role service_role bypassrls;
 set local role service_role;
 insert into test_cases(organization_id,project_id,title) values(org,project,'Service created');
 insert into test_runs(organization_id,project_id,name) values(org,project,'Service created');
 insert into test_executions(organization_id,run_id,test_case_id)
  select org,r.id,c.id from test_runs r cross join test_cases c where r.name='Service created' and c.title='Service created';
 delete from test_runs where name='Service created';
 delete from test_cases where title='Service created';
 update test_executions set result='failed',executed_by=actor,executed_at=now() where id=execution;
 update test_cases set title='Verified API update' where id=case_id;
 update test_runs set status='closed' where id=run_id;
 reset role;
 if (select result from test_executions where id=execution)<>'failed' then raise exception 'Service write blocked'; end if;
 -- Parent authorization is separate. The actual 081 cascade must remain valid.
 set local role authenticated;
 delete from projects where id=project;
 reset role;
 if exists(select 1 from test_cases) or exists(select 1 from test_runs) or exists(select 1 from test_executions) then
   raise exception 'Closed run project cascade blocked'; end if;
end $$;
rollback;
