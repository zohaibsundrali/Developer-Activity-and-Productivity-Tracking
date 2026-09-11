-- Standalone fresh-database fixture; parent runner provides isolated PostgreSQL.
\set ON_ERROR_STOP on
create schema auth;
create schema storage;
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims')::jsonb $$;
create function auth_org() returns uuid language sql stable as $$ select (auth.jwt()->>'org')::uuid $$;
create function auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->>'uid')::uuid $$;
create function auth_is_client() returns boolean language sql stable as $$ select auth.jwt()->'app_metadata'->>'user_type'='client' $$;
create table memberships(organization_id uuid,user_id uuid,user_type text,status text);
create table developer_tasks(id uuid primary key,organization_id uuid,visible boolean);
create table storage.objects(bucket_id text,name text,metadata jsonb);
create table task_attachments(id uuid primary key default gen_random_uuid(),organization_id uuid,task_id uuid references developer_tasks,
 uploaded_by uuid,file_name text,file_path text,file_type text,file_size bigint,created_at timestamptz default now());
alter table developer_tasks enable row level security;
create policy parent_access on developer_tasks for select to authenticated using(visible);
alter table task_attachments enable row level security;
create policy legacy_access on task_attachments for all to authenticated using(true) with check(true);
grant usage on schema auth,storage to authenticated;
grant select on memberships,developer_tasks,storage.objects to authenticated;
grant select,insert,update,delete on task_attachments to authenticated;
insert into memberships values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','developer','active'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','active'),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','developer','active');
insert into developer_tasks values
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',true),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001',false),
 ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000002',true);
insert into task_attachments(organization_id,task_id,uploaded_by,file_name,file_path) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000011','Legacy','legacy/path');
\ir ../../supabase/migrations/20260911100934_production_task_attachment_integrity.sql
do $$ begin if exists(select 1 from task_attachments where uploaded_by_type is not null) then raise exception 'Ambiguous legacy uploader guessed'; end if; end $$;
insert into storage.objects select 'task-submissions','pm/'||organization_id||'/'||id||'/file.pdf','{"size":12,"mimetype":"application/pdf"}'::jsonb from developer_tasks;
set role authenticated;
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000011","app_metadata":{"user_type":"developer"}}',false);
do $$ declare attachment_id uuid; path text:='pm/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000101/file.pdf'; bad_task uuid; bad_org uuid; begin
 insert into task_attachments(organization_id,task_id,uploaded_by,file_name,file_path,file_type,file_size)
 values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'Proof',path,'forged',999) returning id into attachment_id;
 if not exists(select 1 from task_attachments where id=attachment_id and uploaded_by_type='developer' and file_size=12 and file_type='application/pdf') then raise exception 'Authoritative metadata missing'; end if;
 update task_attachments set file_name='Renamed' where id=attachment_id;
 begin
  update task_attachments set uploaded_by_type='admin' where id=attachment_id;
  raise exception 'Uploader identity rewritten';
 exception when insufficient_privilege then null; end;
 begin
  update task_attachments set file_path='forged/path' where id=attachment_id;
  raise exception 'File path rewritten';
 exception when insufficient_privilege then null; end;
 begin
  insert into task_attachments(organization_id,task_id,uploaded_by,uploaded_by_type,file_name,file_path)
  values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'admin','Proof',path);
  raise exception 'Cross-profile uploader accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into task_attachments(organization_id,task_id,uploaded_by,file_name,file_path)
  values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'Proof',replace(path,'file.pdf','missing.pdf'));
  raise exception 'Missing upload accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into task_attachments(organization_id,task_id,uploaded_by,file_name,file_path)
  values(auth_org(),'00000000-0000-0000-0000-000000000101',auth_app_user_id(),'Proof',replace(path,'101/','102/'));
  raise exception 'Other task path accepted';
 exception when invalid_parameter_value then null; end;
 foreach bad_task in array array['00000000-0000-0000-0000-000000000102'::uuid,'00000000-0000-0000-0000-000000000103'::uuid] loop
  bad_org:=case when bad_task::text like '%103' then '00000000-0000-0000-0000-000000000002'::uuid else auth_org() end;
  begin
   insert into task_attachments(organization_id,task_id,uploaded_by,file_name,file_path)
   values(bad_org,bad_task,auth_app_user_id(),'Proof','pm/'||bad_org||'/'||bad_task||'/file.pdf');
   raise exception 'Unauthorized parent accepted';
  exception when insufficient_privilege then null; end;
 end loop;
end $$;
reset role;
update developer_tasks set visible=false where id='00000000-0000-0000-0000-000000000101';
set role authenticated;
do $$ begin if exists(select 1 from task_attachments) then raise exception 'Attachments bypass parent read'; end if; end $$;
reset role;
update developer_tasks set visible=true where id='00000000-0000-0000-0000-000000000101';
set role authenticated;
select set_config('request.jwt.claims','{"org":"00000000-0000-0000-0000-000000000001","uid":"00000000-0000-0000-0000-000000000012","app_metadata":{"user_type":"developer"}}',false);
do $$ declare changed int; begin delete from task_attachments; get diagnostics changed=row_count; if changed<>2 then raise exception 'Collaborator deletion blocked'; end if; end $$;
reset role;
