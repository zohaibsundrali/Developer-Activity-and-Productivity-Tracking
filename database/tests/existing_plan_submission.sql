-- Fresh database; real transaction with minimal membership/project schema.
-- Billing is injected, not an external subscription integration test.
\ir task_authorization_fixture.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
alter table memberships add column id uuid default gen_random_uuid() unique;
alter table user_permissions add column membership_id uuid;
alter table projects add column task_plan_submitted_at timestamptz,add column task_plan_reviewed_at timestamptz,
 add column task_plan_reviewed_by uuid,add column task_plan_rejection_reason text;
create schema app_private;
create function app_private.lock_quota(org uuid) returns void language sql as $$ select pg_advisory_xact_lock(hashtext(org::text)) $$;
create function app_private.org_unlocked(org uuid) returns boolean language sql as $$ select coalesce(current_setting('test.billing_locked',true),'no')<>'yes' $$;
\ir ../../supabase/migrations/20260911113241_production_existing_plan_submission.sql
create function expect_plan_error(command text,expected text) returns void language plpgsql as $$ begin
 begin execute command; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
 raise exception 'Expected refusal: %',expected;
end $$;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); member uuid; result jsonb; original jsonb; command text; begin
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,actor,'developer','developer','active') returning id into member;
 insert into projects(id,organization_id,assigned_developer_id,task_plan_status) values(project,org,actor,'draft');
 command:=format('select submit_existing_task_plan(%L,%L,%L)',org,project,actor);
 perform expect_plan_error(command,'PLAN_INVALID');
 insert into developer_tasks(organization_id,project_id,developer_id,task_title,start_date,end_date) values(org,project,actor,'Preserve me','2026-09-11','2026-09-12');
 update developer_tasks set task_title='  '; perform expect_plan_error(command,'PLAN_INVALID');
 update developer_tasks set task_title='Preserve me',start_date=null; perform expect_plan_error(command,'PLAN_INVALID');
 update developer_tasks set start_date='2026-09-11',end_date=null; perform expect_plan_error(command,'PLAN_INVALID');
 update developer_tasks set end_date='2026-09-10'; perform expect_plan_error(command,'PLAN_INVALID');
 update developer_tasks set end_date='2026-09-12';
 -- Every assigned saved row is validated, not merely the first valid task.
 insert into developer_tasks(organization_id,project_id,developer_id,task_title,start_date,end_date)
 values(org,project,actor,'',current_date,current_date);
 perform expect_plan_error(command,'PLAN_INVALID'); delete from developer_tasks where task_title='';
 select jsonb_agg(to_jsonb(t)) into original from developer_tasks t;
 insert into user_permissions(membership_id,permission_key,allowed) values(member,'task.update_own',false);
 perform expect_plan_error(command,'PLAN_FORBIDDEN'); delete from user_permissions;
 update memberships set status='suspended'; perform expect_plan_error(command,'PLAN_FORBIDDEN'); update memberships set status='active';
 update memberships set user_type='admin'; perform expect_plan_error(command,'PLAN_FORBIDDEN'); update memberships set user_type='developer';
 perform set_config('test.billing_locked','yes',true); perform expect_plan_error(command,'BILLING_LOCKED'); perform set_config('test.billing_locked','no',true);
 update projects set assigned_developer_id=gen_random_uuid(); perform expect_plan_error(command,'PLAN_FORBIDDEN'); update projects set assigned_developer_id=actor;
 perform expect_plan_error(format('select submit_existing_task_plan(%L,%L,%L)',gen_random_uuid(),project,actor),'PLAN_FORBIDDEN');
 result:=submit_existing_task_plan(org,project,actor);
 if result->'project'->>'task_plan_status'<>'pending' then raise exception 'Not submitted'; end if;
 if (submit_existing_task_plan(org,project,actor)->'project') is distinct from result->'project' then raise exception 'Replay mutated project'; end if;
 update projects set task_plan_status='approved'; perform expect_plan_error(command,'PLAN_CONFLICT');
 update projects set task_plan_status='rejected',task_plan_rejection_reason='Old verdict';
 result:=submit_existing_task_plan(org,project,actor);
 if result->'project'->>'task_plan_rejection_reason' is not null then raise exception 'Stale rejection'; end if;
 if (select jsonb_agg(to_jsonb(t)) from developer_tasks t) is distinct from original then raise exception 'Saved task changed'; end if;
 if has_function_privilege('authenticated','submit_existing_task_plan(uuid,uuid,uuid)','execute') or has_function_privilege('anon','submit_existing_task_plan(uuid,uuid,uuid)','execute') then raise exception 'Exposed service transaction'; end if;
 if not has_function_privilege('service_role','submit_existing_task_plan(uuid,uuid,uuid)','execute') then raise exception 'Service transaction unavailable'; end if;
end $$;
