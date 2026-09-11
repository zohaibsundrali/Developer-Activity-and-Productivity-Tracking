-- Fresh database; deliberately broad legacy policies must not leak children.
\ir task_authorization_fixture.sql
\ir ../../supabase/migrations/20260911100211_production_task_authorization.sql
create function auth_org_unlocked() returns boolean language sql stable as $$ select coalesce(current_setting('test.locked',true),'no')<>'yes' $$;
create table task_checklists(id uuid primary key default gen_random_uuid(),organization_id uuid,task_id uuid references developer_tasks on delete cascade,
 text text not null,done boolean default false,sort_order int default 0,created_at timestamptz default now());
create table task_dependencies(id uuid primary key default gen_random_uuid(),organization_id uuid,task_id uuid references developer_tasks on delete cascade,
 depends_on_task_id uuid references developer_tasks on delete cascade,type text default 'blocks' check(type in ('blocks','blocked_by','relates_to')),
 created_at timestamptz default now(),unique(task_id,depends_on_task_id,type));
alter table task_checklists enable row level security;
alter table task_dependencies enable row level security;
create policy legacy_all on task_checklists for all to authenticated using(true) with check(true);
create policy legacy_all on task_dependencies for all to authenticated using(true) with check(true);
grant select,insert,update,delete on task_checklists,task_dependencies to authenticated,service_role;
\ir ../../supabase/migrations/20260911110820_production_task_collaboration_authority.sql
create function collaboration_login(p_org uuid,p_actor uuid,p_type text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',p_org,'user',p_actor,'type',p_type,
 'app_metadata',jsonb_build_object('user_type',p_type))::text,true);
end $$;
create function collaboration_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when insufficient_privilege or invalid_parameter_value then return; end;
 raise exception 'Expected collaboration refusal: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); foreign_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); colleague uuid:=gen_random_uuid();
 project uuid:=gen_random_uuid(); another_project uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); other_task uuid:=gen_random_uuid();
 hidden uuid:=gen_random_uuid(); foreign_task uuid:=gen_random_uuid(); item uuid; dep uuid; changed int;
begin
 insert into memberships values(org,actor,'developer','developer','active'),(org,colleague,'developer','developer','active');
 insert into projects(id,organization_id) values(project,org),(another_project,org);
 insert into developer_tasks(id,organization_id,project_id,developer_id) values(task,org,project,actor),(other_task,org,another_project,actor),
  (hidden,org,project,colleague),(foreign_task,foreign_org,project,actor);
 insert into task_checklists(organization_id,task_id,text) values(org,hidden,'Private checklist'),(org,foreign_task,'Forged tenant reference');
 insert into task_dependencies(organization_id,task_id,depends_on_task_id) values(org,task,hidden),(org,hidden,task),(org,task,foreign_task);
 perform collaboration_login(org,actor,'developer');
 set local role authenticated;
 if exists(select 1 from task_checklists) or exists(select 1 from task_dependencies) then raise exception 'Hidden child leaked'; end if;
 insert into task_checklists(organization_id,task_id,text) values(org,task,'Verify work') returning id into item;
 update task_checklists set done=true;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Bulk checklist edit crossed parent scope'; end if;
 insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(org,task,other_task,'relates_to') returning id into dep;
 update task_dependencies set type='blocked_by';
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Bulk dependency edit crossed parent scope'; end if;
 perform collaboration_denied(format('insert into task_checklists(organization_id,task_id,text) values(%L,%L,''Secret'')',org,hidden));
 perform collaboration_denied(format('insert into task_checklists(organization_id,task_id,text) values(%L,%L,''Wrong org'')',foreign_org,task));
 perform collaboration_denied(format('insert into task_checklists(organization_id,task_id,text) values(%L,%L,'' '')',org,task));
 perform collaboration_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id) values(%L,%L,%L)',org,task,hidden));
 perform collaboration_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id) values(%L,%L,%L)',org,task,foreign_task));
 perform collaboration_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id) values(%L,%L,%L)',org,task,task));
 perform collaboration_denied(format('update task_checklists set task_id=%L where id=%L',other_task,item));
 perform collaboration_denied(format('update task_dependencies set depends_on_task_id=%L where id=%L',task,dep));
 perform set_config('test.locked','yes',true);
 update task_checklists set done=false;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Billing lock bypassed through checklist'; end if;
 delete from task_dependencies;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Billing lock bypassed through dependency deletion'; end if;
 if (select count(*) from task_checklists)<>1 then raise exception 'Billing lock hid reads'; end if;
 perform set_config('test.locked','no',true);
 reset role;
 insert into user_permissions values(actor,'developer','task.view_own',false);
 set local role authenticated;
 if exists(select 1 from task_checklists) or exists(select 1 from task_dependencies) then raise exception 'Parent read deny bypassed'; end if;
 reset role;
 delete from user_permissions;
 update memberships set status='suspended' where user_id=actor and user_type='developer';
 set local role authenticated;
 if exists(select 1 from task_checklists) then raise exception 'Suspended collaborator accepted'; end if;
 reset role;
 update memberships set status='active' where user_id=actor;
 insert into memberships values(org,actor,'client','client','active');
 update developer_tasks set client_visible=true where id=task;
 insert into project_clients values(project,actor);
 perform collaboration_login(org,actor,'client');
 set local role authenticated;
 if exists(select 1 from task_checklists) or exists(select 1 from task_dependencies) then raise exception 'Client exposed staff collaboration'; end if;
 reset role;
 -- Same UUID in an admin profile cannot borrow the developer assignment.
 insert into memberships values(org,actor,'admin','hr','active');
 perform collaboration_login(org,actor,'admin');
 set local role authenticated;
 if exists(select 1 from task_checklists) then raise exception 'Typed parent identity bypass'; end if;
 reset role;
 perform collaboration_login(org,actor,'developer');
 set local role authenticated;
 delete from task_checklists;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Delete did not preserve hidden checklists'; end if;
 delete from task_dependencies;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Delete did not preserve hidden dependencies'; end if;
 reset role;
 -- Trusted service edits and project FK cascades retain their behavior.
 alter role service_role bypassrls;
 set local role service_role;
 update task_checklists set done=true;
 reset role;
 delete from projects;
 if exists(select 1 from task_checklists) or exists(select 1 from task_dependencies) then raise exception 'Child cascade blocked'; end if;
end $$;
rollback;
