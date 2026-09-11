\set ON_ERROR_STOP on
\ir typed_project_ownership.sql
alter table projects add column assigned_to uuid;
-- Include the real legacy schema, backfill and UPDATE-only sync trigger.
\ir ../071_project_members.sql
\ir ../../supabase/migrations/20260911071332_production_project_staffing_permissions.sql
drop function auth_override(text);
\ir ../../supabase/migrations/20260911072728_production_typed_permission_identity.sql
create or replace function app_private.org_unlocked(uuid) returns boolean language sql stable as $$ select false $$;
\ir ../../supabase/migrations/20260911123702_production_typed_project_manager_roster.sql
create or replace function app_private.org_unlocked(uuid) returns boolean language sql stable as $$ select true $$;
do $$ declare org uuid:='74000000-0000-0000-0000-000000000001'; actor uuid:='74000000-0000-0000-0000-000000000011';
 collision uuid:='74000000-0000-0000-0000-000000000013'; project uuid:='74000000-0000-0000-0000-000000000104'; old_member uuid; begin
 -- Foundation fixture assigned a developer manager; legacy071 backfilled it.
 select id into old_member from project_members where project_id=project and user_id=collision and user_type='developer';
 update project_members set allocation_pct=35 where id=old_member;
 -- Same UUID, different typed manager: legacy UPDATE OF manager_id missed this.
 update projects set manager_type='admin' where id=project;
 if not exists(select 1 from project_members where project_id=project and user_id=collision and user_type='admin' and project_role='manager') then raise exception 'Typed admin manager not synchronized'; end if;
 if not exists(select 1 from project_members where id=old_member and project_role='developer' and allocation_pct=35) then raise exception 'Previous manager membership not preserved'; end if;
 if (select count(*) from project_members where project_id=project and user_id=collision)<>2 then raise exception 'Typed roster identity collapsed'; end if;
 update projects set manager_id=null,manager_type=null where id=project;
 if exists(select 1 from project_members where project_id=project and project_role='manager') then raise exception 'Unassignment left manager authority'; end if;
 -- INSERT sync must run for authorized browser creation too.
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated;
 insert into projects(id,organization_id,name,manager_id,manager_type)
 values('74000000-0000-0000-0000-000000000105',org,'Browser manager sync',collision,'admin');
 reset role;
 if not exists(select 1 from project_members where project_id='74000000-0000-0000-0000-000000000105' and user_id=collision and user_type='admin' and project_role='manager') then raise exception 'Project insert omitted typed manager'; end if;
 begin update project_members set project_id=project where project_id='74000000-0000-0000-0000-000000000105' and user_type='admin';
 raise exception 'Current manager identity moved'; exception when check_violation then null; end;
 -- Current manager protection applies to service/database writes, not just API.
 begin delete from project_members where project_id='74000000-0000-0000-0000-000000000105' and user_type='admin';
 raise exception 'Current manager deleted'; exception when check_violation then null; end;
 begin update project_members set project_role='developer' where project_id='74000000-0000-0000-0000-000000000105' and user_type='admin';
 raise exception 'Current manager demoted'; exception when check_violation then null; end;
 begin insert into project_members(organization_id,project_id,user_id,user_type,project_role) values(org,project,actor,'admin','manager');
 raise exception 'Forged service manager accepted'; exception when check_violation then null; end;
 grant all on project_members to authenticated;
 set local role authenticated;
 begin insert into project_members(organization_id,project_id,user_id,user_type,project_role) values(org,project,actor,'admin','manager');
 raise exception 'Forged browser manager accepted'; exception when check_violation then null; end;
 reset role;
 -- Explicit denied assignment still rejected by the real attribution guard.
 insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select actor,'admin','project.assign_manager',false,id from memberships where user_id=actor and user_type='admin';
 set local role authenticated;
 begin
 insert into projects(id,organization_id,name,manager_id,manager_type)
 values('74000000-0000-0000-0000-000000000106',org,'Denied manager',collision,'admin');
 raise exception 'Assignment denial bypassed';
 exception when insufficient_privilege then null; end;
 reset role;
 delete from user_permissions where user_id=actor and user_type='admin';
 update memberships set status='suspended' where user_id=collision and user_type='admin';
 begin update projects set manager_id=collision,manager_type='admin' where id=project;
 raise exception 'Inactive manager assigned'; exception when check_violation then null; end;
 if (select manager_id from projects where id=project) is not null then raise exception 'Failed sync did not roll back project'; end if;
 delete from projects where id='74000000-0000-0000-0000-000000000105';
 if exists(select 1 from project_members where project_id='74000000-0000-0000-0000-000000000105') then raise exception 'Project cascade blocked'; end if;
end $$;
