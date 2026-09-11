\set ON_ERROR_STOP on
\ir notification_insert_authority.sql
alter table memberships add column id uuid default gen_random_uuid() unique,add column team_id uuid,add column department_id uuid,add column reports_to uuid,add column updated_at timestamptz;
create table user_permissions(membership_id uuid,permission_key text,allowed boolean);
create table teams(id uuid primary key,organization_id uuid,name text,manager_id uuid,team_lead_id uuid);
create table employee_profiles(id uuid primary key default gen_random_uuid(),organization_id uuid,membership_id uuid,user_id uuid,user_type text,designation text check(designation<>'INVALID'),employment_status text,weekly_hours numeric,updated_at timestamptz,unique(organization_id,user_id,user_type));
alter table notifications add column metadata jsonb;
create table change_requests(id uuid,organization_id uuid);
create function auth_role() returns text language sql stable as $$ select auth.jwt()->'app_metadata'->>'role' $$;
create function auth_is_client() returns boolean language sql stable as $$ select auth.jwt()->'app_metadata'->>'user_type'='client' $$;
create function auth_override(k text) returns boolean language sql stable as $$ select (auth.jwt()->'test_overrides'->>k)::boolean $$;
\ir ../../supabase/migrations/20260911065148_production_permission_field_guards.sql
alter table memberships enable row level security;
alter table employee_profiles enable row level security;
create policy members_read on memberships for select to authenticated using(organization_id=auth_org());
create policy profile_read on employee_profiles for select to authenticated using(organization_id=auth_org());
create policy profile_insert on employee_profiles for insert to authenticated with check(organization_id=auth_org() and coalesce(auth_override('employee.onboard'),auth_role() in ('owner','admin','hr')));
grant select,insert,update on employee_profiles to authenticated;
grant update on memberships to authenticated;
\ir ../../supabase/migrations/20260911163620_production_atomic_employee_save.sql
create function employee_expect_failure(command text) returns void language plpgsql security invoker as $$ begin
 begin execute command; exception when insufficient_privilege or check_violation or invalid_parameter_value then return; end;
 raise exception 'Expected refused employee save'; end $$;
create function employee_fail_notice() returns trigger language plpgsql as $$ begin if current_setting('test.employee_fail',true)='yes' then raise exception 'EMPLOYEE_NOTICE_FAILURE'; end if; return new; end $$;
create trigger employee_failure before insert on notifications for each row execute function employee_fail_notice();
do $$ declare org uuid:='00000000-0000-0000-0000-000000000001'; employee uuid:='00000000-0000-0000-0000-000000000012'; member_id uuid; team uuid:='82000000-0000-0000-0000-000000000001'; n bigint; begin
 update memberships set role='owner' where user_type='admin';
 select id into member_id from memberships where organization_id=org and user_id=employee and user_type='developer';
 insert into teams values(team,org,'Delivery','00000000-0000-0000-0000-000000000011',null);
 perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('organization_id',org,'app_user_id','00000000-0000-0000-0000-000000000011','user_type','admin','role','owner'))::text,true);
 set local role authenticated;
 perform employee_expect_failure(format('select save_employee_record(%L,%L,%L,''developer'',''{"status":"suspended"}'',''{"designation":"INVALID"}'')',org,member_id,employee));
 reset role;
 if (select status from memberships where id=member_id)<>'active' or exists(select 1 from notifications where type='employee_status_changed') then raise exception 'Failed profile partially committed membership or notice'; end if;
 set local role authenticated;
 perform save_employee_record(org,member_id,employee,'developer',jsonb_build_object('team_id',team),'{"designation":"Engineer"}');
 reset role;
 if (select count(*) from notifications where type='team_assigned')<>1 or exists(select 1 from notifications where type='team_member_added') then raise exception 'Typed assignee missing or ambiguous leader notified'; end if;
 select count(*) into n from notifications;
 set local role authenticated;
 perform save_employee_record(org,member_id,employee,'developer',jsonb_build_object('team_id',team),'{"designation":"Engineer"}');
 perform employee_expect_failure(format('select save_employee_record(%L,%L,%L,''admin'',''{}'',''{"designation":"Other"}'')',org,member_id,employee));
 perform employee_expect_failure(format('select save_employee_record(%L,%L,%L,''developer'',''{}'',''{"user_id":"00000000-0000-0000-0000-000000000011"}'')',org,member_id,employee));
 reset role;
 if (select count(*) from notifications)<>n then raise exception 'No-op repeated notices'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('organization_id',org,'app_user_id','00000000-0000-0000-0000-000000000011','user_type','admin','role','owner'),'test_overrides',jsonb_build_object('employee.manage',false))::text,true);
 set local role authenticated;
 perform employee_expect_failure(format('select save_employee_record(%L,%L,%L,''developer'',''{"status":"suspended"}'',''{"designation":"Changed"}'')',org,member_id,employee));
 reset role;
 if (select status from memberships where id=member_id)<>'active' then raise exception 'Field denial did not roll back membership'; end if;
 set local role authenticated;
 perform save_employee_record(org,member_id,employee,'developer','{"status":"suspended"}','{}');
 reset role;
 if (select count(*) from notifications where type='employee_status_changed')<>1 then raise exception 'Status notification missing'; end if;
 perform set_config('test.employee_fail','yes',true);
 set local role authenticated;
 begin
  perform save_employee_record(org,member_id,employee,'developer','{"status":"active"}','{}');
  raise exception 'Expected employee notice failure';
 exception when others then if sqlerrm<>'EMPLOYEE_NOTICE_FAILURE' then raise; end if; end;
 reset role;
 if (select status from memberships where id=member_id)<>'suspended' then raise exception 'Notice failure committed status'; end if;
 perform set_config('test.employee_fail','no',true);
 set local role authenticated;
 perform expect_notice_denied('{"type":"employee_status_changed","developer_id":"00000000-0000-0000-0000-000000000011"}');
 reset role;
end $$;
