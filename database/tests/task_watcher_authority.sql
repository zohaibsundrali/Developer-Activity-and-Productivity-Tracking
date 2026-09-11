-- Fresh isolated database, reuse active typed parent-access fixture.
\set ON_ERROR_STOP on
\ir task_attachment_integrity.sql
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
alter table memberships add column id uuid default gen_random_uuid(), add column role text default 'developer';
create table user_permissions(membership_id uuid,permission_key text,allowed boolean);
create table projects(id uuid primary key,organization_id uuid,created_by uuid,added_by uuid);
alter table developer_tasks add column project_id uuid,add column developer_id uuid;
create table task_submissions(organization_id uuid,task_id uuid,developer_id uuid,review_status text);
create table task_watchers(id uuid primary key default gen_random_uuid(),organization_id uuid,task_id uuid,
 user_id uuid,user_type text,role text default 'watcher',created_at timestamptz default now(),unique(task_id,user_id,role));
alter table task_watchers enable row level security;
create policy legacy_watchers on task_watchers for all to authenticated using(true) with check(true);
grant select,insert,update,delete on task_watchers to authenticated;
create function auth_org_unlocked() returns boolean language sql stable as $$ select coalesce((auth.jwt()->>'unlocked')::boolean,true) $$;
-- auth_task_capability below is copied verbatim from production migration
-- 20260911100211; typed membership/override helpers mirror production identity.
create function auth_role() returns text language sql stable as $$
 select role from memberships where organization_id=auth_org() and user_id=auth_app_user_id()
  and user_type=auth.jwt()->'app_metadata'->>'user_type' and status='active' $$;
create function auth_override(p_key text) returns boolean language sql stable security definer set search_path=public as $$
 select up.allowed from user_permissions up join memberships m on m.id=up.membership_id
 where m.organization_id=auth_org() and m.user_id=auth_app_user_id()
  and m.user_type=auth.jwt()->'app_metadata'->>'user_type' and m.status='active' and up.permission_key=p_key limit 1 $$;
update memberships set role='admin' where user_type='admin';
create or replace function public.auth_task_capability(p_key text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.auth_org() is not null and not public.auth_is_client()
    and auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
    and coalesce(public.auth_override(p_key),case
      when p_key in ('task.manage','task.view_all') then public.auth_role() in ('owner','admin','manager','team_lead')
      when p_key in ('task.review','bug.raise','bug.triage') then public.auth_role() in ('owner','admin','manager','team_lead','qa')
      when p_key in ('task.view_own','task.update_own') then public.auth_role() in
        ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee')
      else false end,false)
    and p_key in ('task.manage','task.view_all','task.review','bug.raise','bug.triage','task.view_own','task.update_own');
$$;
\ir ../../supabase/migrations/20260911110750_production_task_watcher_authority.sql
insert into projects values('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013',null);
update developer_tasks set project_id='00000000-0000-0000-0000-000000000100',developer_id='00000000-0000-0000-0000-000000000011' where id='00000000-0000-0000-0000-000000000101';
insert into memberships(organization_id,user_id,user_type,status,role) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013','developer','active','qa');
set role authenticated;
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","app_metadata":{"user_type":"developer"}}',false);
do $$ declare row_id uuid; changed int; begin
 insert into task_watchers(organization_id,task_id,user_id,user_type,role)
 values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'developer','watcher') returning id into row_id;
 insert into task_watchers(organization_id,task_id,user_id,user_type,role)
 values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'developer','watcher')
 on conflict(task_id,user_type,user_id,role) do update set organization_id=excluded.organization_id;
 if (select count(*) from task_watchers)<>1 then raise exception 'Self watch retry duplicated'; end if;
 begin
  insert into task_watchers(organization_id,task_id,user_id,user_type,role)
  values(auth_org(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000012','developer','watcher');
  raise exception 'Arbitrary colleague subscribed';
 exception when insufficient_privilege then null; end;
 begin
  insert into task_watchers(organization_id,task_id,user_id,user_type,role)
  values(auth_org(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer','reviewer');
  raise exception 'Contributor assigned reviewer';
 exception when insufficient_privilege then null; end;
 begin
  update task_watchers set user_type='admin' where id=row_id;
  raise exception 'Watcher profile rewritten';
 exception when insufficient_privilege then null; end;
 begin
  insert into task_watchers(organization_id,task_id,user_id,user_type,role)
  values(auth_org(),'00000000-0000-0000-0000-000000000102',auth_app_user_id(),'developer','watcher');
  raise exception 'Hidden task watched';
 exception when insufficient_privilege then null; end;
end $$;
-- Billing lock preserves reads, but blocks every watcher mutation, including
-- DELETE (which the old WITH CHECK-only policies did not cover).
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","unlocked":false,"app_metadata":{"user_type":"developer"}}',false);
do $$ declare changed int; begin
 if (select count(*) from task_watchers)<>1 then raise exception 'Billing lock removed watcher read access'; end if;
 delete from task_watchers where user_id=auth_app_user_id(); get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Billing lock allowed watcher deletion'; end if;
 update task_watchers set role='watcher' where user_id=auth_app_user_id(); get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Billing lock allowed watcher update'; end if;
 begin
  insert into task_watchers(organization_id,task_id,user_id,user_type,role)
  values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'developer','watcher')
  on conflict(task_id,user_type,user_id,role) do update set organization_id=excluded.organization_id;
  raise exception 'Billing lock allowed watcher upsert';
 exception when insufficient_privilege then null; end;
end $$;
-- Same UUID, other profile: independent watcher, independent unsubscribe.
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","role":"admin","app_metadata":{"user_type":"admin"}}',false);
do $$ declare changed int; begin
 insert into task_watchers(organization_id,task_id,user_id,user_type,role)
 values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'admin','watcher');
 if (select count(*) from task_watchers)<>2 then raise exception 'Typed UUID watch collision'; end if;
 delete from task_watchers where user_id=auth_app_user_id() and user_type='admin' and role='watcher';
 if (select count(*) from task_watchers)<>1 then raise exception 'Unwatch deleted other profile'; end if;
 insert into task_watchers(organization_id,task_id,user_id,user_type,role)
 values(auth_org(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer','reviewer');
 begin
  insert into task_watchers(organization_id,task_id,user_id,user_type,role)
  values(auth_org(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000012','developer','reviewer');
  raise exception 'Unqualified reviewer assigned';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into user_permissions select id,'task.review',false from memberships where user_id='00000000-0000-0000-0000-000000000013';
do $$ begin
 if task_watcher_reviewer_eligible('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer') then raise exception 'Reviewer override ignored'; end if;
end $$;
delete from user_permissions;
insert into task_submissions values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','pending');
do $$ begin
 if task_watcher_reviewer_eligible('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer') then raise exception 'Proof author can review own proof'; end if;
end $$;
delete from task_submissions;
insert into memberships(organization_id,user_id,user_type,status,role)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013','admin','active','admin');
do $$ begin
 if task_watcher_reviewer_eligible('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer') then raise exception 'Ambiguous creator granted review subscription'; end if;
end $$;
delete from memberships where user_id='00000000-0000-0000-0000-000000000013' and user_type='admin';
update memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000013';
do $$ begin
 if task_watcher_reviewer_eligible('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer') then raise exception 'Suspended reviewer accepted'; end if;
end $$;
-- Exercise the real catalogue predicate for QA/team-lead actors, and ensure
-- typed explicit denies beat each role's default reviewer-assignment authority.
update memberships set status='active' where user_id='00000000-0000-0000-0000-000000000013';
do $$ declare actor_role text; begin
 foreach actor_role in array array['qa','team_lead'] loop
  update memberships set role=actor_role where user_id='00000000-0000-0000-0000-000000000012';
  perform set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000012","app_metadata":{"user_type":"developer"}}',false);
  set local role authenticated;
  insert into task_watchers(organization_id,task_id,user_id,user_type,role)
   values(auth_org(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer','reviewer')
   on conflict(task_id,user_type,user_id,role) do update set organization_id=excluded.organization_id;
  reset role;
  insert into user_permissions select id,'task.review',false from memberships where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
  insert into user_permissions select id,'task.manage',false from memberships where user_id='00000000-0000-0000-0000-000000000012' and user_type='developer';
  set local role authenticated;
  begin
   insert into task_watchers(organization_id,task_id,user_id,user_type,role)
    values(auth_org(),'00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000013','developer','reviewer')
    on conflict(task_id,user_type,user_id,role) do update set organization_id=excluded.organization_id;
   raise exception 'Writer explicit deny ignored';
  exception when insufficient_privilege then null; end;
  reset role;
  delete from user_permissions;
 end loop;
end $$;
update developer_tasks set visible=false where id='00000000-0000-0000-0000-000000000101';
set role authenticated;
do $$ begin if exists(select 1 from task_watchers) then raise exception 'Watchers bypass parent visibility'; end if; end $$;
reset role;
