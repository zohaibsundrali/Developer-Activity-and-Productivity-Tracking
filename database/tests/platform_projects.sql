-- Run after platform_owner_console.sql and platform_management_access fixture.
\set ON_ERROR_STOP on
alter table public.projects add column if not exists archived boolean default false, add column if not exists status text;
-- Fixture billing state is controlled explicitly; the production trigger is real.
create or replace function app_private.org_unlocked(uuid) returns boolean language sql as $$ select coalesce(current_setting('test.locked',true),'no')<>'yes' $$;
\if :{?platform_suite_installed}
\else
\ir ../../supabase/migrations/20260920115133_platform_project_management.sql
\endif
-- Install the actual billing guard where the minimal base fixture omitted it.
drop trigger if exists delivery_write_lock on public.projects;
create trigger delivery_write_lock before insert or update or delete on public.projects for each row execute function app_private.guard_delivery_write_lock();
create table project_delete_fixture(id uuid primary key,project_id uuid references public.projects(id) on delete cascade);
do $$
declare owner_id uuid:=gen_random_uuid();owner_session uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); outsider_session uuid:=gen_random_uuid();org uuid:=gen_random_uuid();project uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner_id,'project-owner@example.test',now()),(outsider,'project-outsider@example.test',now());
 insert into auth.sessions(id,user_id) values(owner_session,owner_id),(outsider_session,outsider);
 insert into app_private.platform_owners(auth_user_id) values(owner_id);
 insert into public.organizations(id,name,status) values(org,'Project fixture','active');
 insert into public.projects(id,organization_id,name,status) values(project,org,'Exact project name','active');
 insert into project_delete_fixture values(gen_random_uuid(),project);
 perform set_config('test.locked','yes',true);
 begin update public.projects set archived=true where id=project; raise exception 'Billing lock bypassed';exception when sqlstate 'P0001' then if sqlerrm not like 'BILLING_LOCKED:%' then raise;end if;end;
 set local role service_role;
 begin perform platform_project_action(outsider,outsider_session,project,'delete','Unauthorized test','Exact project name');raise exception 'Outsider mutation allowed';exception when insufficient_privilege then null;end;
 perform platform_project_action(owner_id,owner_session,project,'archive','Archive test fixture');
 reset role;
 if not (select archived from projects where id=project) then raise exception 'Archive failed';end if;
 set local role service_role;
 perform platform_project_action(owner_id,owner_session,project,'restore','Restore test fixture');
 begin perform platform_project_action(owner_id,owner_session,project,'delete','Remove test fixture','Wrong name');raise exception 'Wrong name accepted';exception when invalid_parameter_value then null;end;
 reset role;
 if (select archived from projects where id=project) then raise exception 'Restore failed';end if;
 if not exists(select 1 from projects where id=project) then raise exception 'Bad confirmation deleted project';end if;
 set local role service_role;
 perform platform_project_action(owner_id,owner_session,project,'delete','Remove test fixture','Exact project name');
 reset role;
 if exists(select 1 from projects where id=project) or exists(select 1 from project_delete_fixture where project_id=project) then raise exception 'Delete cascade incomplete';end if;
 if (select count(*) from app_private.platform_audit where actor_id=owner_id and action like 'project.%')<>3 then raise exception 'Audit count incorrect';end if;
 if has_function_privilege('authenticated','public.platform_project_action(uuid,uuid,uuid,text,text,text)','EXECUTE') then raise exception 'RPC exposed to tenant role';end if;
end $$;
select 'Platform project actions passed' as result;
