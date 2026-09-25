-- Standalone regression: real cycle trigger, including invisible graph edges.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create schema app_private;
create table app_private.quota_locks(organization_id uuid primary key,revision bigint not null);
create function app_private.lock_quota(p_org uuid) returns void language sql volatile security definer set search_path=pg_catalog,public,app_private as $$
 insert into app_private.quota_locks values(p_org,1) on conflict(organization_id) do update set revision=quota_locks.revision+1;
$$;
create function public.auth_org() returns uuid language sql stable as $$ select nullif(current_setting('test.org',true),'')::uuid $$;
create table task_dependencies(id uuid primary key default gen_random_uuid(),organization_id uuid not null,task_id uuid not null,depends_on_task_id uuid not null,type text not null,hidden boolean default false);
alter table task_dependencies enable row level security;
grant select,insert,update,delete on task_dependencies to authenticated;
create policy scoped on task_dependencies to authenticated using(organization_id=auth_org() and not hidden) with check(organization_id=auth_org());
\ir ../../supabase/migrations/20260925072952_task_dependency_cycle_guard.sql
create function cycle_denied(command text) returns void language plpgsql as $$ begin
 begin execute command; exception when check_violation then return; end;
 raise exception 'Expected blocking cycle rejection: %',command;
end $$;
begin;
do $$ declare org uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); link uuid;
begin
 perform set_config('test.org',org::text,true);
 set local role authenticated;
 insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(org,a,b,'blocks');
 -- Same direction expressed inversely is legitimate.
 insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(org,b,a,'blocked_by');
 perform cycle_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(%L,%L,%L,''blocks'')',org,b,a));
 perform cycle_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(%L,%L,%L,''blocked_by'')',org,a,b));
 perform cycle_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(%L,%L,%L,''blocks'')',org,a,a));
 insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(org,b,c,'blocks');
 perform cycle_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(%L,%L,%L,''blocks'')',org,c,a));
 insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(org,c,a,'relates_to') returning id into link;
 insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(org,a,c,'relates_to');
 perform cycle_denied(format('update task_dependencies set type=''blocks'' where id=%L',link));
 -- A hidden intermediate edge must still participate in cycle detection.
 reset role;
 update task_dependencies set hidden=true where task_id=b and depends_on_task_id=c;
 set local role authenticated;
 if exists(select 1 from task_dependencies where task_id=b and depends_on_task_id=c) then raise exception 'Fixture edge should be hidden'; end if;
 perform cycle_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(%L,%L,%L,''blocks'')',org,c,a));
 -- Multi-row statement must roll back both rows when the second closes a cycle.
 delete from task_dependencies;
 reset role;
 delete from task_dependencies;
 set local role authenticated;
 perform cycle_denied(format('insert into task_dependencies(organization_id,task_id,depends_on_task_id,type) values(%L,%L,%L,''blocks''),(%L,%L,%L,''blocks'')',org,a,b,org,b,a));
 if exists(select 1 from task_dependencies) then raise exception 'Rejected batch left rows'; end if;
 reset role;
 if has_function_privilege('authenticated','app_private.guard_task_dependency_cycle()','execute')
   or has_function_privilege('anon','app_private.guard_task_dependency_cycle()','execute') then raise exception 'Trigger must not be callable'; end if;
end $$;
rollback;
