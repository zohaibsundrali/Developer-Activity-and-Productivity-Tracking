\set ON_ERROR_STOP on
\ir durable_actor_automation_jobs.sql
-- Upgrade the small fixture's claims/override helpers to production identity
-- semantics before exercising the service worker (no fake user/type JWT keys).
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator; end if; end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create or replace function auth_app_user_id() returns uuid language sql stable as $$ select nullif(auth.jwt()->'app_metadata'->>'app_user_id','')::uuid $$;
create or replace function auth_is_client() returns boolean language sql stable as $$ select coalesce(auth.jwt()->'app_metadata'->>'user_type'='client',false) $$;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb,deleted_at timestamptz,banned_until timestamptz);
create table admin_users(id uuid,organization_id uuid,auth_user_id uuid);
create table developers(id uuid,organization_id uuid,auth_user_id uuid);
create table project_members(project_id uuid,organization_id uuid,user_id uuid,user_type text,project_role text);
-- Exact catalogue ranks from database/070.
create function role_rank(p_role text) returns integer language sql immutable as $$ select case p_role
 when 'owner' then 100 when 'admin' then 90 when 'manager' then 70 when 'hr' then 60 when 'finance' then 55
 when 'team_lead' then 50 when 'qa' then 35 when 'developer' then 30 when 'designer' then 30 when 'devops' then 30 when 'employee' then 20 when 'client' then 10 end $$;
\ir ../../supabase/migrations/20260911044517_audit_membership_authority.sql
-- Drop only to permit the production definition's original parameter name.
drop function auth_override(text);
\ir ../../supabase/migrations/20260911072728_production_typed_permission_identity.sql
create function app_private.organization_deleting(uuid) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.org_deleting',true),''),'no')='yes' $$;
alter table notifications add column dedupe_key text;
create unique index on notifications(dedupe_key) where dedupe_key is not null;
alter table notifications enable row level security;
grant insert,select on notifications to authenticated;
create policy notices_insert on notifications for insert to authenticated with check(organization_id=auth_org());
\ir ../../supabase/migrations/20260911180306_production_unattended_actor_automation.sql
create function unattended_denied(j uuid,l uuid,operation text default 'apply') returns void language plpgsql as $$ begin
 begin perform run_unattended_automation_step(j,l,operation); exception when insufficient_privilege then return; end;
 raise exception 'Expected unattended permission refusal';
end $$;
delete from user_permissions;
-- Keep one existing real captured job and restore its rule/action/lease.
update automation_jobs set status='completed';
update automation_jobs set status='processing',lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',external_started=false,
 actions='[{"type":"set_priority","priority":"high"}]',next_action=0,
 task_snapshot=(select to_jsonb(t) from developer_tasks t where t.id=automation_jobs.task_id),
 rule_id=(select id from automation_rules where name='Create priority')
 where id=(select id from automation_jobs order by created_at,id limit 1);
insert into auth.users(id,raw_app_meta_data) values('80000000-0000-0000-0000-000000000901',
 '{"organization_id":"80000000-0000-0000-0000-000000000001","app_user_id":"80000000-0000-0000-0000-000000000012","user_type":"admin","role":"owner"}');
insert into admin_users values('80000000-0000-0000-0000-000000000012','80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000901');
do $$ declare j automation_jobs%rowtype; original text:='{"role":"service_role"}'; n bigint; begin
 select * into strict j from automation_jobs where status='processing';
 perform set_config('request.jwt.claims',original,true);
 set local role service_role;
 perform run_unattended_automation_step(j.id,j.lease,'apply');
 perform run_unattended_automation_step(j.id,j.lease,'apply');
 reset role;
 if current_setting('request.jwt.claims')<>original then raise exception 'Actor claims escaped success'; end if;
 if (select priority from developer_tasks where id=j.task_id)<>'high' then raise exception 'Unattended action did not commit'; end if;
 -- Both direct authenticated entry and private helper are forbidden.
 set local role authenticated;
 perform unattended_denied(j.id,j.lease);
 begin perform private.run_automation_as_actor(j.id,j.lease,'apply'); raise exception 'Private helper exposed'; exception when insufficient_privilege then null; end;
 reset role;
 set local role service_role;
 begin perform private.run_automation_as_actor(j.id,j.lease,'apply'); raise exception 'Service could directly assume actor'; exception when insufficient_privilege then null; end;
 reset role;
 -- Explicit deny applies despite elevated service entry; claims restore on error.
 insert into user_permissions(membership_id,permission_key,allowed) select id,'task.manage',false from memberships where user_id=j.actor_id and user_type=j.actor_type;
 set local role service_role;
 perform unattended_denied(j.id,j.lease);
 reset role;
 if current_setting('request.jwt.claims')<>original then raise exception 'Actor claims escaped error'; end if;
 delete from user_permissions;
 update memberships set status='suspended' where user_id=j.actor_id and user_type=j.actor_type;
 perform unattended_denied(j.id,j.lease);
 update memberships set status='active',role='client' where user_id=j.actor_id and user_type=j.actor_type;
 perform unattended_denied(j.id,j.lease);
 update memberships set role='owner' where user_id=j.actor_id and user_type=j.actor_type;
 -- A colliding Developer membership cannot inherit the Admin Auth mapping.
 update automation_jobs set actor_type='developer' where id=j.id;
 perform unattended_denied(j.id,j.lease);
 update automation_jobs set actor_type='admin' where id=j.id;
 update admin_users set organization_id=gen_random_uuid(); perform unattended_denied(j.id,j.lease);
 update admin_users set organization_id=j.organization_id;
 update auth.users set banned_until=now()+interval '1 day'; perform unattended_denied(j.id,j.lease); update auth.users set banned_until=null;
 perform set_config('test.automation_plan','no',true); perform unattended_denied(j.id,j.lease); perform set_config('test.automation_plan','yes',true);
 perform set_config('test.org_deleting','yes',true); perform unattended_denied(j.id,j.lease); perform set_config('test.org_deleting','no',true);
 -- A foreign task cannot be read through a job with a different org actor.
 update automation_jobs set organization_id='80000000-0000-0000-0000-000000000001' where id=j.id;
 update developer_tasks set organization_id=gen_random_uuid() where id=j.task_id; perform unattended_denied(j.id,j.lease);
 update developer_tasks set organization_id=j.organization_id where id=j.task_id;
 -- Stored notifications are inserted under actor RLS and dedupe on retry.
 update automation_jobs set actions='[{"type":"notify","message":"Stored message"}]' where id=j.id;
 set local role service_role;
 perform run_unattended_automation_step(j.id,j.lease,'notice');
 perform run_unattended_automation_step(j.id,j.lease,'notice');
 reset role;
 if (select count(*) from notifications where dedupe_key='automation:'||j.id||':0')<>1 then raise exception 'Unattended notice retry duplicated'; end if;
 if pg_has_role('authenticated','automation_actor_executor','member') or pg_has_role('service_role','automation_actor_executor','member')
  or pg_has_role('authenticator','automation_actor_executor','member') then raise exception 'Login/API role can assume executor'; end if;
end $$;
-- Scheduler uses bounded, due work, isolates inactive actors, and does not
-- automatically retry permanent failures or uncertain external delivery.
do $$ declare j automation_jobs%rowtype; begin
 select * into strict j from automation_jobs where status='processing';
 update automation_jobs set status='pending' where id=j.id;
 set local role service_role;
 if (select count(*) from pending_automation_actors(1))<>1 then raise exception 'Eligible unattended actor not selected'; end if;
 reset role;
 perform set_config('test.org_deleting','yes',true);
 if exists(select 1 from pending_automation_actors()) then raise exception 'Deleting organization selected'; end if;
 perform set_config('test.org_deleting','no',true);
 update automation_jobs set status='failed',next_attempt_at=null where id=j.id;
 if exists(select 1 from pending_automation_actors()) then raise exception 'Permanent failure automatically retried'; end if;
 update automation_jobs set status='pending' where id=j.id;
 update memberships set status='suspended' where organization_id=j.organization_id and user_id=j.actor_id and user_type=j.actor_type;
 perform pending_automation_actors();
 if (select status from automation_jobs where id=j.id)<>'cancelled' then raise exception 'Inactive actor abandoned job not cancelled'; end if;
 update automation_jobs set status='processing',external_started=true,lease_until=now()-interval '1 minute' where id=j.id;
 perform pending_automation_actors();
 if (select status from automation_jobs where id=j.id)<>'delivery_unknown' then raise exception 'Inactive actor lost uncertain delivery evidence'; end if;
end $$;
-- Migration preflight rejects owner-based RLS bypass and unexpected members,
-- while permitting the sole intended fixed-operation helper ownership.
select private.assert_automation_executor_safe();
do $$ begin
 begin
  create table public.executor_owned_probe(id integer);
  alter table public.executor_owned_probe owner to automation_actor_executor;
  perform private.assert_automation_executor_safe();
  raise exception 'Owned table accepted';
 exception when raise_exception then
  if sqlerrm<>'Automation executor owns unexpected database objects' then raise; end if;
 end;
 begin
  create schema executor_owned_schema authorization automation_actor_executor;
  perform private.assert_automation_executor_safe();
  raise exception 'Owned schema accepted';
 exception when raise_exception then
  if sqlerrm<>'Automation executor owns unexpected database objects' then raise; end if;
 end;
 begin
  create function public.executor_owned_probe() returns integer language sql as 'select 1';
  alter function public.executor_owned_probe() owner to automation_actor_executor;
  perform private.assert_automation_executor_safe();
  raise exception 'Unexpected owned function accepted';
 exception when raise_exception then
  if sqlerrm<>'Automation executor owns unexpected database objects' then raise; end if;
 end;
 begin
  grant automation_actor_executor to service_role;
  perform private.assert_automation_executor_safe();
  raise exception 'Unexpected role member accepted';
 exception when raise_exception then
  if sqlerrm<>'Unexpected role can assume automation executor' then raise; end if;
 end;
 begin
  grant service_role to automation_actor_executor;
  perform private.assert_automation_executor_safe();
  raise exception 'Unexpected inherited role accepted';
 exception when raise_exception then
  if sqlerrm<>'Automation executor inherits unexpected authority' then raise; end if;
 end;
 perform private.assert_automation_executor_safe();
end $$;
