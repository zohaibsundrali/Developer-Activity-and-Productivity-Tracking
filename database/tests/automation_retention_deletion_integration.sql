\set ON_ERROR_STOP on
-- Load actual unattended migration/tests first, then the subsequent retention
-- and lifecycle migrations in their chronological deployment order.
\ir unattended_actor_automation.sql
-- Restore the production quota-lock FK omitted by the focused task fixture.
alter table app_private.quota_locks add foreign key(organization_id) references organizations(id) on delete cascade;
alter table organizations add column status text default 'active',add column name text;
create table clients(id uuid primary key,organization_id uuid,auth_user_id uuid);
create table organization_subscriptions(organization_id uuid primary key,stripe_customer_id text,stripe_subscription_id text);
create table screenshots(id uuid primary key default gen_random_uuid(),organization_id uuid,storage_path text,timestamp timestamptz,developer_id uuid);
create table keyboard_stats(id uuid primary key default gen_random_uuid(),organization_id uuid,timestamp timestamptz);
create table project_proposals(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid references projects on delete set null,
 status text,decision_reason text,updated_at timestamptz,decided_at timestamptz);
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),updated_at timestamptz default now(),owner_id text);
alter table storage.objects enable row level security;
create policy storage_fixture on storage.objects for all to authenticated using(true) with check(true);
grant usage on schema storage to authenticated;
grant all on storage.objects to authenticated;
create function app_private.plan_limit(uuid,text) returns bigint language sql stable as $$ select 30::bigint $$;
-- Exact public wrapper semantics from feature_history_guards: private plan
-- internals remain definer-only after retention revokes private execution.
create or replace function auth_plan_feature(k text) returns boolean language sql stable security definer set search_path=pg_catalog,public,app_private as $$ select auth_org() is not null and app_private.plan_feature(auth_org(),k) $$;
\ir ../../supabase/migrations/20260911180503_production_tracking_retention_jobs.sql
-- Replace the isolated deletion predicate double with the real ledger helper.
drop function app_private.organization_deleting(uuid);
\ir ../../supabase/migrations/20260911180815_production_organization_deletion_lifecycle.sql

do $$ declare org uuid:='97000000-0000-0000-0000-000000000001'; other_org uuid:='97000000-0000-0000-0000-000000000002';
 actor uuid:='97000000-0000-0000-0000-000000000011'; developer uuid:='97000000-0000-0000-0000-000000000012';
 auth_id uuid:='97000000-0000-0000-0000-000000000091'; project uuid:='97000000-0000-0000-0000-000000000101';
 task uuid:='97000000-0000-0000-0000-000000000201'; aj jsonb; dj jsonb; item jsonb; deletion uuid; sweep jsonb; claims text;
begin
 insert into organizations(id,name) values(org,'Integration delete'),(other_org,'Integration keep');
 insert into memberships(organization_id,user_id,user_type,role,status) values(org,actor,'admin','owner','active'),(org,developer,'developer','developer','active');
 insert into admin_users values(actor,org,auth_id);insert into developers values(developer,org,null);
 insert into auth.users(id,raw_app_meta_data) values(auth_id,jsonb_build_object('organization_id',org,'app_user_id',actor,'user_type','admin','role','owner'));
 -- A Developer-profile owner can manage retention using its own typed Auth link.
 insert into memberships(organization_id,user_id,user_type,role,status) values(other_org,'97000000-0000-0000-0000-000000000013','developer','owner','active');
 insert into developers values('97000000-0000-0000-0000-000000000013',other_org,'97000000-0000-0000-0000-000000000093');
 insert into auth.users(id,raw_app_meta_data) values('97000000-0000-0000-0000-000000000093',jsonb_build_object('organization_id',other_org,'app_user_id','97000000-0000-0000-0000-000000000013','user_type','developer','role','owner'));
 perform set_config('request.jwt.claims',jsonb_build_object('sub','97000000-0000-0000-0000-000000000093','app_metadata',jsonb_build_object('organization_id',other_org,'app_user_id','97000000-0000-0000-0000-000000000013','user_type','developer','role','owner'))::text,true);
 set local role authenticated;
 perform set_tracking_retention(other_org,'custom',60,true);
 reset role;
 if not exists(select 1 from tracking_retention_policies where organization_id=other_org and days=60) then raise exception 'Developer owner retention denied'; end if;
 insert into projects(id,organization_id,name) values(project,org,'Combined project');
 insert into automation_rules(organization_id,name,trigger,actions) values(org,'Combined rule','{"event":"task_created"}','[{"type":"set_priority","priority":"high"}]');
 claims:=jsonb_build_object('sub',auth_id,'role','authenticated','app_metadata',jsonb_build_object('organization_id',org,'app_user_id',actor,'user_type','admin','role','owner'))::text;
 perform set_config('request.jwt.claims',claims,true);
 set local role authenticated;
 insert into developer_tasks(id,organization_id,project_id,developer_id,task_title) values(task,org,project,developer,'Combined work');
 perform set_tracking_retention(org,'custom',30,true);
 reset role;
 set local role service_role;
 aj:=claim_actor_automation_job(org,actor,'admin',false);
 perform run_unattended_automation_step((aj->>'id')::uuid,(aj->>'lease')::uuid,'apply');
 reset role;
 if (select priority from developer_tasks where id=task)<>'high' then raise exception 'Lifecycle auth_org replacement broke active unattended work'; end if;
 insert into screenshots(organization_id,developer_id,storage_path,timestamp) values(org,developer,org||'/'||developer||'/old.png',now()-interval '90 days');
 insert into storage.objects(bucket_id,name,created_at,updated_at) values('monitoring',org||'/'||developer||'/old.png',now()-interval '90 days',now()-interval '90 days'),('org-files',other_org||'/keep.pdf',now(),now());
 set local role service_role;
 sweep:=sweep_tracking_retention(org);
 if (sweep->>'queued')::int<>1 then raise exception 'Retention did not queue canonical screenshot: %',sweep; end if;
 deletion:=start_organization_deletion(org,actor,'admin',auth_id,'Integration delete',repeat('c',64));
 reset role;
 if auth_org() is not null then raise exception 'Lifecycle replacement did not freeze old claims'; end if;
 set local role service_role;
 perform unattended_denied((aj->>'id')::uuid,(aj->>'lease')::uuid);
 if claim_retention_file(org) is not null then raise exception 'Retention claimed deleting tenant'; end if;
 if exists(select 1 from pending_automation_actors() where organization_id=org) then raise exception 'Worker selected deleting tenant'; end if;
 reset role;
 set local role authenticated;
 if exists(select 1 from developer_tasks where id=task) then raise exception 'Old actor can read deleted-in-progress task'; end if;
 reset role;
 -- Isolated provider stand-ins remove only claimed resources, then real RPCs
 -- verify absence/checkpoint and advance the durable lifecycle.
 set local role service_role;
 dj:=claim_organization_deletion(org,true);
 perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,'storage');
 dj:=claim_organization_deletion(org,true);
 for item in select * from jsonb_array_elements(organization_deletion_items(deletion,(dj->>'lease')::uuid,'storage')) loop
  if check_deletion_storage_item(deletion,(dj->>'lease')::uuid,(item->>'id')::uuid)<>'present' then raise exception 'Storage inventory mismatch'; end if;
  reset role;
  delete from storage.objects where id::text=item->>'resource_id';
  set local role service_role;
  if check_deletion_storage_item(deletion,(dj->>'lease')::uuid,(item->>'id')::uuid)<>'absent' then raise exception 'Storage absence not confirmed'; end if;
  perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,null,(item->>'id')::uuid);
 end loop;
 perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,'auth');
 dj:=claim_organization_deletion(org,true);
 for item in select * from jsonb_array_elements(organization_deletion_items(deletion,(dj->>'lease')::uuid,'auth')) loop
  if not check_deletion_auth_identity(deletion,(dj->>'lease')::uuid,(item->>'id')::uuid) then raise exception 'Valid exclusive Auth identity refused'; end if;
  reset role;delete from auth.users where id::text=item->>'resource_id';set local role service_role;
  perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,null,(item->>'id')::uuid);
 end loop;
 perform finish_organization_deletion_step(deletion,(dj->>'lease')::uuid,'database');
 dj:=claim_organization_deletion(org,true);
 perform finalize_organization_deletion(deletion,(dj->>'lease')::uuid);
 reset role;
 if exists(select 1 from organizations where id=org) or exists(select 1 from automation_jobs where organization_id=org)
  or exists(select 1 from screenshots where organization_id=org) or exists(select 1 from tracking_retention_policies where organization_id=org)
  or exists(select 1 from app_private.tracking_retention_files where organization_id=org) then raise exception 'Combined cleanup retained tenant rows'; end if;
 if not exists(select 1 from storage.objects where name=other_org||'/keep.pdf') or not exists(select 1 from organizations where id=other_org) then raise exception 'Combined cleanup touched foreign tenant'; end if;
 if organization_deletion_status(null,null,repeat('c',64))->>'status'<>'completed' then raise exception 'Deletion receipt lost'; end if;
end $$;
