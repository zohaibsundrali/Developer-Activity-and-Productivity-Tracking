-- Fresh database with real project/task/relationship guards. Quota failures are
-- injected here; the production quota trigger is covered by the shared suite.
\ir task_authorization_fixture.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
create function auth_org_unlocked() returns boolean language sql stable as $$ select coalesce(current_setting('test.clone_locked',true),'no')<>'yes' $$;
create schema app_private;
create function app_private.lock_quota(p_org uuid) returns void language plpgsql as $$ begin return; end $$;
alter table projects add column name text,add column description text,add column status text default 'pending',add column progress numeric default 0,
 add column total_tasks_count int default 0,add column completed_tasks_count int default 0,add column total_productivity_score numeric default 0,
 add column is_template boolean default false,add column archived boolean default false,add column created_at timestamptz default now(),add column updated_at timestamptz,
 add column task_plan_submitted_at timestamptz,add column task_plan_reviewed_at timestamptz,add column task_plan_reviewed_by uuid,add column task_plan_rejection_reason text,
 add column completed_at timestamptz,add column completed_by uuid,add column client_signed_off_at timestamptz,add column client_rating int,add column client_feedback text,
 add column closed_at timestamptz,add column closed_by uuid,add column closure_note text,add column created_by uuid,add column added_by uuid;
alter table developer_tasks add column parent_task_id uuid,add column sprint_id uuid,add column epic_id uuid,
 add column created_at timestamptz default now(),add column story_points int,add column labels text[];
create table sprints(id uuid primary key,organization_id uuid,project_id uuid references projects on delete cascade,status text);
create table epics(id uuid primary key,organization_id uuid,project_id uuid references projects on delete cascade);
grant all on sprints,epics to authenticated;
alter table projects enable row level security;
create policy legacy_projects on projects for all to authenticated using(organization_id=auth_org()) with check(organization_id=auth_org());
\ir ../../supabase/migrations/20260911100211_production_task_authorization.sql
\ir ../../supabase/migrations/20260911101008_production_project_mutation_authority.sql
\ir ../../supabase/migrations/20260911083449_production_task_review_integrity.sql
\ir ../../supabase/migrations/20260911110640_production_task_relationship_integrity.sql
\ir ../../supabase/migrations/20260911111253_production_project_clone_transaction.sql
create function clone_fail_task() returns trigger language plpgsql as $$ begin
 if current_setting('test.clone_task_failure',true)='yes' and new.task_title='Child' then raise exception 'INJECTED_TASK_FAILURE'; end if;
 if current_setting('test.clone_quota_failure',true)='yes' then raise exception 'PLAN_LIMIT_REACHED: tasks'; end if;
 return new;
end $$;
create trigger clone_failure after insert on developer_tasks for each row execute function clone_fail_task();
create function clone_expect(command text,expected text) returns void language plpgsql as $$ begin
 begin execute command; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise; end;
 raise exception 'Expected clone failure: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); developer uuid:=gen_random_uuid(); project uuid:=gen_random_uuid();
 parent uuid:='90000000-0000-0000-0000-000000000002'; child uuid:='90000000-0000-0000-0000-000000000001';
 global_task uuid:=gen_random_uuid(); global_sprint uuid:=gen_random_uuid(); global_epic uuid:=gen_random_uuid();
 sprint uuid:=gen_random_uuid(); epic uuid:=gen_random_uuid(); result jsonb; clone uuid; clone_parent uuid; clone_child uuid;
 before_projects int; before_tasks int; command text;
begin
 insert into memberships values(org,actor,'admin','owner','active'),(org,developer,'developer','developer','active');
 insert into projects(id,organization_id,name,description,assigned_developer_id,created_by,added_by,task_plan_status,task_plan_submitted,
  status,progress,total_tasks_count,completed_tasks_count,total_productivity_score,closed_at,closed_by,completed_at,client_rating)
 values(project,org,'Source','Configuration',developer,actor,actor,'approved',true,'closed',100,3,3,8,now(),actor,now(),5);
 insert into sprints values(sprint,org,project,'active'),(global_sprint,org,null,'active');
 insert into epics values(epic,org,project),(global_epic,org,null);
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,status,client_visible,sprint_id,epic_id,story_points,labels)
 values(parent,org,project,developer,'Parent','completed',true,sprint,epic,8,array['backend']);
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,status,parent_task_id,sprint_id,epic_id)
 values(child,org,project,developer,'Child','completed',parent,sprint,epic),(global_task,org,project,developer,'Global','pending',null,global_sprint,global_epic);
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 command:=format('select clone_project(%L,''Clone'',true)',project);
 select count(*) into before_projects from projects; select count(*) into before_tasks from developer_tasks;
 set local role authenticated;
 perform set_config('test.clone_task_failure','yes',true);
 perform clone_expect(command,'INJECTED_TASK_FAILURE');
 perform set_config('test.clone_task_failure','no',true);
 perform set_config('test.clone_quota_failure','yes',true);
 perform clone_expect(command,'PLAN_LIMIT_REACHED');
 perform set_config('test.clone_quota_failure','no',true);
 if (select count(*) from projects)<>before_projects or (select count(*) from developer_tasks)<>before_tasks then raise exception 'Failed clone left partial rows'; end if;
 result:=clone_project(project,'Clone',true);
 clone:=(result->'project'->>'id')::uuid;
 if (result->>'tasks')::int<>3 then raise exception 'Clone omitted tasks'; end if;
 select id into clone_parent from developer_tasks where project_id=clone and task_title='Parent';
 select id into clone_child from developer_tasks where project_id=clone and task_title='Child';
 if (select parent_task_id from developer_tasks where id=clone_child) is distinct from clone_parent then raise exception 'Parent was not remapped'; end if;
 if exists(select 1 from developer_tasks where project_id=clone and (status<>'pending' or client_visible or productivity_points<>0)) then raise exception 'Task verdict/publication copied'; end if;
 if exists(select 1 from developer_tasks where project_id=clone and task_title in ('Parent','Child') and (sprint_id is not null or epic_id is not null)) then raise exception 'Project containers copied'; end if;
 if (select sprint_id from developer_tasks where project_id=clone and task_title='Global') is distinct from global_sprint then raise exception 'Global sprint lost'; end if;
 if (select story_points from developer_tasks where id=clone_parent)<>8 then raise exception 'Task configuration lost'; end if;
 if exists(select 1 from projects where id=clone and (status<>'pending' or progress<>0 or task_plan_submitted or task_plan_status<>'draft' or closed_at is not null or client_rating is not null)) then raise exception 'Project history copied'; end if;
 result:=clone_project(project,'Empty',false);
 if exists(select 1 from developer_tasks where project_id=(result->'project'->>'id')::uuid) then raise exception 'copyTasks false ignored'; end if;
 perform set_config('test.clone_locked','yes',true);
 perform clone_expect(command,'BILLING_LOCKED');
 perform set_config('test.clone_locked','no',true);
 reset role;
 insert into user_permissions values(actor,'admin','project.hub',false);
 set local role authenticated;
 result:=clone_project(project,'Create without hub update',false);
 if result->'project'->>'id' is null then raise exception 'Unrelated hub deny blocked clone'; end if;
 reset role;
 delete from user_permissions;
 insert into user_permissions values(actor,'admin','project.create',false);
 set local role authenticated;
 perform clone_expect(command,'CLONE_FORBIDDEN');
 reset role;
 delete from user_permissions;
 insert into user_permissions values(actor,'admin','task.manage',false);
 set local role authenticated;
 perform clone_expect(command,'Defect creation');
 reset role;
end $$;
rollback;
