-- Standalone fixture: run in a fresh isolated database, as postgres.
\set ON_ERROR_STOP on
create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims')::jsonb $$;
create function auth_org() returns uuid language sql stable as $$ select (auth.jwt()->>'org')::uuid $$;
create function auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->>'uid')::uuid $$;
create function auth_role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create function auth_is_client() returns boolean language sql stable as $$ select auth.jwt()->'app_metadata'->>'user_type'='client' $$;
create function auth_plan_feature(text) returns boolean language sql stable as $$ select coalesce((auth.jwt()->>'portal')::boolean,true) $$;
create function auth_client_project_ids() returns setof uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000100'::uuid $$;
create table admin_users(id uuid,organization_id uuid,name text);
create table developers(id uuid,organization_id uuid,name text);
create table clients(id uuid,organization_id uuid,name text);
create table memberships(organization_id uuid,user_id uuid,user_type text,status text);
create table developer_tasks(id uuid primary key,organization_id uuid,project_id uuid,client_visible boolean,visible boolean);
create table task_comments(id uuid primary key default gen_random_uuid(),organization_id uuid,task_id uuid references developer_tasks,
 author_id uuid,author_type text,author_name text,body text,internal boolean default false,created_at timestamptz default now());
alter table developer_tasks enable row level security;
create policy parent_access on developer_tasks for select to authenticated using(visible);
alter table task_comments enable row level security;
-- Deliberately reproduce a broad legacy permissive policy: new restrictions
-- must hold independently of forgotten or future permissive grants.
create policy legacy_comments on task_comments for all to authenticated using(true) with check(true);
grant usage on schema auth to authenticated;
grant select on memberships,developer_tasks,admin_users,developers,clients to authenticated;
grant select,insert,update,delete on task_comments to authenticated;
\ir ../../supabase/migrations/20260911095524_production_task_comment_integrity.sql
insert into developers values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Actual Developer');
insert into admin_users values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Actual Admin');
insert into clients values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','Actual Client');
insert into memberships values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','developer','active'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','active'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','client','active');
insert into developer_tasks values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000100',true,true),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000100',false,false),
 ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000100',true,true),
 ('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000200',true,true);
set role authenticated;
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","role":"developer","app_metadata":{"user_type":"developer"}}',false);
do $$ declare comment_id uuid; bad_task uuid; changed int; begin
 insert into task_comments(organization_id,task_id,author_id,author_type,body,author_name)
 values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'developer','Original','Forged Owner') returning id into comment_id;
 if (select author_name from task_comments where id=comment_id)<>'Actual Developer' then raise exception 'Spoofed display name accepted'; end if;
 update task_comments set body='Edited' where id=comment_id;
 if (select body from task_comments where id=comment_id)<>'Edited' then raise exception 'Own edit failed'; end if;
 foreach bad_task in array array['00000000-0000-0000-0000-000000000102'::uuid,'00000000-0000-0000-0000-000000000103'::uuid] loop
  begin
   insert into task_comments(organization_id,task_id,author_id,author_type) values(auth_org(),bad_task,auth_app_user_id(),'developer');
   raise exception 'Unauthorized task accepted';
  exception when insufficient_privilege then null; end;
 end loop;
 begin
  insert into task_comments(organization_id,task_id,author_id,author_type) values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'admin');
  raise exception 'Cross-profile author accepted';
 exception when insufficient_privilege then null; end;
 begin
  update task_comments set task_id='00000000-0000-0000-0000-000000000104' where id=comment_id;
  raise exception 'Comment moved';
 exception when insufficient_privilege then null; end;
 begin
  update task_comments set author_type='admin' where id=comment_id;
  raise exception 'Comment author rewritten';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","role":"hr","app_metadata":{"user_type":"admin"}}',false);
 update task_comments set body='Collision' where id=comment_id; get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Cross-profile UUID edited comment'; end if;
 perform set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","role":"admin","app_metadata":{"user_type":"admin"}}',false);
 update task_comments set body='Moderated',internal=true where id=comment_id; get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Staff moderation failed'; end if;
end $$;
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000012","role":"client","app_metadata":{"user_type":"client"}}',false);
do $$ declare comment_id uuid; changed int; begin
 if exists(select 1 from task_comments) then raise exception 'Client read internal comment'; end if;
 insert into task_comments(organization_id,task_id,author_id,author_type,body)
 values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'client','Client comment') returning id into comment_id;
 update task_comments set body='Rewritten' where id=comment_id; get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Client edited comment'; end if;
 delete from task_comments where id=comment_id; get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Client deleted comment'; end if;
 begin
  insert into task_comments(organization_id,task_id,author_id,author_type) values(auth_org(),'00000000-0000-0000-0000-000000000104',auth_app_user_id(),'client');
  raise exception 'Unlinked project accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000012","role":"client","portal":false,"app_metadata":{"user_type":"client"}}',false);
 if exists(select 1 from task_comments) then raise exception 'Client plan denied but comments visible'; end if;
end $$;
reset role;
update developer_tasks set visible=false where id='00000000-0000-0000-0000-000000000101';
set role authenticated;
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","role":"developer","app_metadata":{"user_type":"developer"}}',false);
do $$ begin
 if exists(select 1 from task_comments) then raise exception 'Comments bypass parent RLS'; end if;
end $$;
reset role;
