\set ON_ERROR_STOP on
\ir automation_retention_deletion_integration.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin; end if; end $$;
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
alter table auth.users add column email text,add column email_confirmed_at timestamptz;
alter table admin_users add primary key(id),add column email text,add column full_name text,add column company text,add column role text,add column is_verified boolean;
alter table developers add column name text,add column email text;
alter table clients add column name text,add column email text;
alter table organizations add column owner_id uuid references admin_users(id) on delete set null,add column industry text,add column company_size text,add column country text,add column timezone text;
create table billing_plans(code text primary key,is_active boolean,trial_days int);
insert into billing_plans values('free',true,0);
alter table organization_subscriptions add column plan_code text,add column status text,add column trial_start timestamptz,add column trial_end timestamptz;
alter table memberships add column email text;
create table terms_acceptances(organization_id uuid,user_id uuid,user_type text,email text,document text,document_version text,entry_point text,accepted_at timestamptz);
\ir ../../supabase/migrations/20260920051306_authenticated_organization_workspaces.sql

do $$ declare uid uuid:='80000000-0000-0000-0000-000000000901'; old_org uuid:='80000000-0000-0000-0000-000000000001';
 new_workspace jsonb; oid uuid; pid uuid; tid uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); context jsonb; job jsonb; deletion uuid; dj jsonb; item jsonb;
begin
 update auth.users set email='multi@example.test',email_confirmed_at=now() where id=uid;
 update memberships set role='owner',status='active',deletion_blocked=false where organization_id=old_org and user_type='admin';
 update admin_users set full_name='Workspace Owner',email='multi@example.test' where auth_user_id=uid;
 update organizations set status='active' where id=old_org;
 new_workspace:=create_authenticated_workspace(uid,gen_random_uuid(),'{"company":"Secondary workspace"}','free','v1');
 oid:=(new_workspace->>'organizationId')::uuid;pid:=(new_workspace->>'profileId')::uuid;
 insert into auth.sessions values(sid,uid);
 context:=select_workspace(uid,sid,oid,pid,'admin');
 insert into projects(id,organization_id,name) values(project,oid,'Secondary project');
 insert into automation_rules(organization_id,name,enabled,trigger,actions,created_by)
 values(oid,'Secondary auto',true,'{"event":"task_created"}','[{"type":"set_priority","priority":"high"}]',pid);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'role','authenticated','app_metadata',context)::text,true);
 set local role authenticated;
 insert into developer_tasks(id,organization_id,project_id,task_title,priority) values(tid,oid,project,'Second workspace task','medium');
 reset role;
 job:=claim_actor_automation_job(oid,pid,'admin',false);
 if job is null then raise exception 'Secondary workspace automation was not captured'; end if;
 set local role service_role;
 perform run_unattended_automation_step((job->>'id')::uuid,(job->>'lease')::uuid,'apply');
 reset role;
 if (select priority from developer_tasks where id=tid)<>'high' then raise exception 'Secondary workspace automation failed'; end if;
 -- Deleting a secondary workspace must not delete its shared Auth identity.
 deletion:=start_organization_deletion(oid,pid,'admin',uid,'Secondary workspace',repeat('d',64));
 if auth_org() is not null then raise exception 'Deletion failed to freeze selected workspace'; end if;
 if public.workspace_context(uid,sid,true) is null then raise exception 'Owner cannot resume deletion'; end if;
 dj:=claim_organization_deletion(oid,true);
 perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,'auth');
 dj:=claim_organization_deletion(oid,true);
 for item in select * from jsonb_array_elements(organization_deletion_items(deletion,(dj->>'lease')::uuid,'auth')) loop
  if check_deletion_auth_identity(deletion,(dj->>'lease')::uuid,(item->>'id')::uuid) then raise exception 'Shared identity would be deleted'; end if;
  perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,null,(item->>'id')::uuid,true);
 end loop;
 perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,'database');
 dj:=claim_organization_deletion(oid,true);
 perform finalize_organization_deletion(deletion,(dj->>'lease')::uuid);
 if not exists(select 1 from auth.users where id=uid) or not exists(select 1 from organizations where id=old_org) then raise exception 'Primary workspace/identity lost'; end if;
 if exists(select 1 from organizations where id=oid) then raise exception 'Secondary workspace not deleted'; end if;
end $$;
