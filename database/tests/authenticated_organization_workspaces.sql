\set ON_ERROR_STOP on
\ir transactional_signup_recovery.sql
create role supabase_auth_admin;
create table public.user_permissions(membership_id uuid,permission_key text,allowed boolean);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
alter table organizations add column status text not null default 'active';
alter table memberships add column deletion_blocked boolean not null default false;
create function app_private.organization_deleting(uuid) returns boolean language sql stable as $$select false$$;
-- Lifecycle function signatures compile against these minimal row types;
-- full lifecycle integration is exercised in the separate integration fixture.
create table public.automation_jobs(id uuid primary key,organization_id uuid,actor_id uuid,actor_type text,lease uuid,status text,lease_until timestamptz);
create table app_private.organization_deletions(id uuid,organization_id uuid,organization_name text);
\ir ../../supabase/migrations/20260920051306_authenticated_organization_workspaces.sql

do $$ declare uid uuid; old_org uuid; old_profile uuid; new_org uuid; new_profile uuid;
 sid uuid:=gen_random_uuid(); other_sid uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); result jsonb; prior jsonb; ctx jsonb; claims jsonb; cnt int;
begin
 select id,raw_app_meta_data into uid,prior from auth.users where email='owner@example.test';
 old_org:=(prior->>'organization_id')::uuid; old_profile:=(prior->>'app_user_id')::uuid;
 insert into auth.sessions values(sid,uid),(other_sid,uid);
 ctx:=public.workspace_context(uid,sid);
 if ctx->>'organization_id' is distinct from old_org::text then raise exception 'Default context lost'; end if;
 result:=public.create_authenticated_workspace(uid,rid,'{"company":"Second organization","timezone":"UTC"}','professional','v1');
 new_org:=(result->>'organizationId')::uuid; new_profile:=(result->>'profileId')::uuid;
 if result is distinct from public.create_authenticated_workspace(uid,rid,'{"company":"Changed name"}','enterprise','v2') then raise exception 'Retry duplicated/changed workspace'; end if;
 if (select raw_app_meta_data from auth.users where id=uid) is distinct from prior then raise exception 'Other sessions were switched'; end if;
 if not exists(select 1 from admin_users where id=new_profile and auth_user_id=uid and email='owner@example.test') then raise exception 'Existing identity not reused'; end if;
 if not exists(select 1 from organization_subscriptions where organization_id=new_org and plan_code='professional' and status='trialing') then raise exception 'Trial rules broken'; end if;
 if jsonb_array_length(public.list_workspaces(uid))<>2 then raise exception 'Workspace listing incorrect'; end if;
 insert into public.user_permissions select id,'project.view_all',false from public.memberships where organization_id=new_org;
 if exists(select 1 from jsonb_array_elements(public.list_workspaces(uid)) o where o->>'id'=new_org::text and o->'projects'<>'null'::jsonb) then raise exception 'Project count ignored explicit deny'; end if;
 delete from public.user_permissions;

 if public.list_workspaces(gen_random_uuid())<>'[]'::jsonb then raise exception 'Unrelated identity saw workspace'; end if;
 perform expect_rejected(format('select select_workspace(%L,%L,%L,%L,''admin'')',uid,sid,old_org,new_profile),'WORKSPACE_FORBIDDEN');
 perform expect_rejected(format('select select_workspace(%L,%L,%L,%L,''admin'')',gen_random_uuid(),sid,new_org,new_profile),'WORKSPACE_UNAUTHENTICATED');
 perform expect_rejected(format('select select_workspace(%L,%L,%L,%L,''developer'')',uid,sid,new_org,new_profile),'WORKSPACE_FORBIDDEN');
 ctx:=public.select_workspace(uid,sid,new_org,new_profile,'admin');
 if public.workspace_context(uid,other_sid)->>'organization_id' is distinct from old_org::text then raise exception 'Independent session changed'; end if;
 claims:=jsonb_build_object('sub',uid,'session_id',sid,'app_metadata',prior,'role','authenticated');
 perform set_config('request.jwt.claims',claims::text,true);
 if public.auth_org() is not null then raise exception 'Stale token retained workspace access after switching'; end if;
 claims:=public.workspace_access_token_hook(jsonb_build_object('user_id',uid,'claims',claims))->'claims';
 perform set_config('request.jwt.claims',claims::text,true);
 if public.auth_org() is distinct from new_org then raise exception 'Refreshed token cannot enter selected workspace'; end if;
 -- Direct SQL read as authenticated exercises auth_org, not just helper output.
 execute 'alter table organizations enable row level security';
 execute 'create policy test_workspace_isolation on organizations for select to authenticated using(id=public.auth_org())';
 execute 'grant select on organizations to authenticated';
 execute 'set local role authenticated';
 select count(*) into cnt from organizations;
 if cnt<>1 then raise exception 'RLS leaked organization rows'; end if;
 execute 'reset role';
 update memberships set status='suspended' where organization_id=new_org;
 if public.workspace_context(uid,sid) is not null or public.auth_org() is not null then raise exception 'Suspended member retained access'; end if;
 if jsonb_array_length(public.list_workspaces(uid))<>1 then raise exception 'Suspended workspace listed'; end if;
 update memberships set status='active' where organization_id=new_org;
 update admin_users set auth_user_id=gen_random_uuid() where id=new_profile;
 if public.auth_org() is not null then raise exception 'Relinked profile retained access'; end if;
 update admin_users set auth_user_id=uid where id=new_profile;
 update memberships set deletion_blocked=true where organization_id=new_org;
 if public.auth_org() is not null then raise exception 'Deletion-blocked member retained access'; end if;
 update memberships set deletion_blocked=false where organization_id=new_org;
 update organizations set status='suspended' where id=new_org;
 if public.auth_org() is not null then raise exception 'Suspended organization retained access'; end if;
 update organizations set status='active' where id=new_org;
 -- Mandatory insert failure rolls back ALL new organization rows.
 select count(*) into cnt from organizations;
 perform set_config('test.fail_table','terms_acceptances',true);
 perform expect_rejected(format('select create_authenticated_workspace(%L,%L,''{"company":"Failure"}'',''free'',''v1'')',uid,gen_random_uuid()),'Injected mandatory row failure');
 if (select count(*) from organizations)<>cnt then raise exception 'Partial organization persisted'; end if;
 perform set_config('test.fail_table','',true);
 update auth.users set email_confirmed_at=null where id=uid;
 perform expect_rejected(format('select create_authenticated_workspace(%L,%L,''{"company":"Unverified"}'',''free'',''v1'')',uid,gen_random_uuid()),'WORKSPACE_UNAUTHENTICATED');
 update auth.users set email_confirmed_at=now() where id=uid;
 if has_function_privilege('authenticated','public.create_authenticated_workspace(uuid,uuid,jsonb,text,text)','execute')
 or has_function_privilege('anon','public.list_workspaces(uuid)','execute')
 or has_function_privilege('authenticated','public.select_workspace(uuid,uuid,uuid,uuid,text)','execute')
 or has_function_privilege('authenticated','public.workspace_access_token_hook(jsonb)','execute')
 or has_table_privilege('authenticated','app_private.workspace_sessions','select') then raise exception 'Privileged workspace interfaces exposed'; end if;
 if not has_function_privilege('supabase_auth_admin','public.workspace_access_token_hook(jsonb)','execute') then raise exception 'Auth hook unavailable'; end if;
end $$;
