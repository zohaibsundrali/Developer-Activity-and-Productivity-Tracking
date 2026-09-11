\ir task_authorization_fixture.sql
create schema app_private;
create table app_private.quota_locks(organization_id uuid primary key,revision bigint not null);
create function app_private.lock_quota(p_org uuid) returns void language sql volatile security definer set search_path=pg_catalog,public,app_private as $$
 insert into app_private.quota_locks(organization_id,revision) values(p_org,1)
 on conflict(organization_id) do update set revision=quota_locks.revision+1;
$$;
alter table developer_tasks add column parent_task_id uuid,add column sprint_id uuid,add column epic_id uuid;
create table sprints(id uuid primary key,organization_id uuid,project_id uuid references projects on delete cascade,status text);
create table epics(id uuid primary key,organization_id uuid,project_id uuid references projects on delete cascade);
grant all on sprints,epics to authenticated,service_role;
alter table sprints enable row level security;
alter table epics enable row level security;
create policy scoped on sprints for all to authenticated using(organization_id=auth_org()) with check(organization_id=auth_org());
create policy scoped on epics for all to authenticated using(organization_id=auth_org()) with check(organization_id=auth_org());
\ir ../../supabase/migrations/20260911100211_production_task_authorization.sql
\ir ../../supabase/migrations/20260911110640_production_task_relationship_integrity.sql
create function relationship_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when check_violation or foreign_key_violation then return; end;
 raise exception 'Expected invalid reference refusal: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); otherorg uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
 project uuid:=gen_random_uuid(); otherproject uuid:=gen_random_uuid(); foreignproject uuid:=gen_random_uuid();
 task uuid:=gen_random_uuid(); parent uuid:=gen_random_uuid(); wrongparent uuid:=gen_random_uuid();
 sprint uuid:=gen_random_uuid(); wrongsprint uuid:=gen_random_uuid(); foreignsprint uuid:=gen_random_uuid();
 epic uuid:=gen_random_uuid(); wrongepic uuid:=gen_random_uuid(); globale uuid:=gen_random_uuid(); globals uuid:=gen_random_uuid();
 changed int; hiddenancestor uuid:=gen_random_uuid();
begin
 insert into memberships values(org,actor,'admin','owner','active');
 insert into projects(id,organization_id) values(project,org),(otherproject,org),(foreignproject,otherorg);
 insert into developer_tasks(id,organization_id,project_id) values(task,org,project),(parent,org,project),(wrongparent,org,otherproject);
 insert into sprints values(sprint,org,project,'active'),(wrongsprint,org,otherproject,'planned'),(foreignsprint,otherorg,foreignproject,'planned'),(globals,org,null,'planned');
 insert into epics values(epic,org,project),(wrongepic,org,otherproject),(globale,org,null);
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin',
 'app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated;
 update developer_tasks set parent_task_id=parent,sprint_id=sprint,epic_id=epic where id=task;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Legitimate task relationships blocked'; end if;
 perform relationship_denied(format('update developer_tasks set parent_task_id=id where id=%L',task));
 perform relationship_denied(format('update developer_tasks set parent_task_id=%L where id=%L',task,parent));
 perform relationship_denied(format('update developer_tasks set parent_task_id=%L where id=%L',wrongparent,task));
 perform relationship_denied(format('update developer_tasks set sprint_id=%L where id=%L',wrongsprint,task));
 perform relationship_denied(format('update developer_tasks set sprint_id=%L where id=%L',foreignsprint,task));
 perform relationship_denied(format('update developer_tasks set epic_id=%L where id=%L',wrongepic,task));
 perform relationship_denied(format('update developer_tasks set epic_id=%L where id=%L',gen_random_uuid(),task));
 perform relationship_denied(format('delete from sprints where id=%L',sprint));
 perform relationship_denied(format('delete from epics where id=%L',epic));
 perform relationship_denied(format('delete from developer_tasks where id=%L',parent));
 perform relationship_denied(format('update sprints set project_id=%L where id=%L',otherproject,sprint));
 perform relationship_denied(format('update epics set organization_id=%L where id=%L',otherorg,epic));
 update sprints set status='completed' where id=sprint;
 -- Existing work can still progress in a completed sprint; adding new work cannot.
 update developer_tasks set task_title='Existing sprint work' where id=task;
 perform relationship_denied(format('update developer_tasks set sprint_id=%L where id=%L',sprint,parent));
 update developer_tasks set sprint_id=null,parent_task_id=null,epic_id=null where id=task;
 perform relationship_denied(format('update developer_tasks set sprint_id=%L where id=%L',sprint,task));
 update developer_tasks set sprint_id=globals,epic_id=globale where id=task;
 update developer_tasks set sprint_id=null,epic_id=null where id=task;
 delete from sprints where id=sprint;
 delete from epics where id=epic;
 -- A hidden intermediate ancestor must not truncate cycle detection.
 reset role;
 insert into developer_tasks(id,organization_id,project_id) values(hiddenancestor,org,project);
 update developer_tasks set parent_task_id=null,task_type='bug' where id=task;
 update developer_tasks set parent_task_id=hiddenancestor,task_type='bug' where id=parent;
 update developer_tasks set parent_task_id=task where id=hiddenancestor;
 insert into user_permissions values(actor,'admin','task.view_all',false),(actor,'admin','task.review',false);
 set local role authenticated;
 if exists(select 1 from developer_tasks where id=hiddenancestor) then raise exception 'Ancestor should be hidden in fixture'; end if;
 perform relationship_denied(format('update developer_tasks set parent_task_id=%L where id=%L',parent,task));
 reset role;
 delete from user_permissions;
 update developer_tasks set parent_task_id=null,task_type='feature' where id in (parent,task);
 delete from developer_tasks where id=hiddenancestor;
 -- A management grant cannot attach a parent denied by task read authority.

 insert into user_permissions values(actor,'admin','task.view_all',false),(actor,'admin','task.review',false);
 set local role authenticated;
 perform relationship_denied(format('insert into developer_tasks(organization_id,project_id,parent_task_id) values(%L,%L,%L)',org,project,parent));
 reset role;
 delete from user_permissions;
 insert into sprints values(sprint,org,project,'active');
 insert into epics values(epic,org,project);
 update developer_tasks set parent_task_id=parent,sprint_id=sprint,epic_id=epic where id=task;
 set local role authenticated;
 delete from projects where id=project;
 reset role;
 if exists(select 1 from developer_tasks where project_id=project) then raise exception 'Project cascade failed'; end if;
end $$;
rollback;
