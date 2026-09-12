-- Isolated fixture using verified production screenshot column types.
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
\ir quota_fixture.sql
-- Recreate only the isolated synthetic table before applying actual guards.
drop table screenshots;
create table screenshots(
 id uuid primary key default gen_random_uuid(),organization_id uuid references organizations on delete cascade,
 developer_id uuid not null,developer_email text not null,filename text not null,storage_path text not null,
 public_url text,width integer not null,height integer not null,size_kb numeric not null,mime_type text not null,
 app_active text,is_annotated boolean default false,annotation_text text,timestamp timestamptz default now(),created_at timestamptz default now()
);
grant select,insert,update,delete on screenshots to authenticated;
alter table screenshots enable row level security;
create policy screenshot_tenant on screenshots for all to authenticated
 using(organization_id=public.auth_org()) with check(organization_id=public.auth_org());
\ir ../../supabase/migrations/20260911055537_production_quota_enforcement.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now());
create function public.auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->'app_metadata'->>'app_user_id')::uuid $$;
create function public.auth_role() returns text language sql stable as $$ select auth.jwt()->'app_metadata'->>'role' $$;
create function public.auth_override(text) returns boolean language sql stable as $$ select null::boolean $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select,insert,update on storage.objects to authenticated;
create policy storage_tenant on storage.objects for all to authenticated
 using(split_part(name,'/',1)=public.auth_org()::text) with check(split_part(name,'/',1)=public.auth_org()::text);
insert into developers(id,organization_id) values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002');
\ir ../../supabase/migrations/20260911062805_production_device_sessions.sql
\ir ../../supabase/migrations/20260912070957_production_idempotent_screenshot_capture.sql

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000011","session_id":"00000000-0000-0000-0000-000000000021","email":"dev@example.test","app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"00000000-0000-0000-0000-000000000012","user_type":"developer","role":"developer"}}',false);
create function screenshot_test_payload(cap uuid) returns jsonb language sql as $$
 select jsonb_build_object('organization_id',public.auth_org(),'developer_id',public.auth_app_user_id(),
 'developer_email','dev@example.test','filename','capture_'||cap||'.png','storage_path',public.auth_org()||'/'||public.auth_app_user_id()||'/capture_'||cap||'.png',
 'public_url',null,'width',1920,'height',1080,'size_kb',1,'mime_type','image/png','app_active','Editor','is_annotated',false,'annotation_text',null,'timestamp','2026-09-12T07:00:00.000Z'); $$;

do $$
#variable_conflict use_variable
declare cap uuid:='10000000-0000-0000-0000-000000000001'; cap2 uuid:='10000000-0000-0000-0000-000000000002';
 cap3 uuid:='10000000-0000-0000-0000-000000000003'; metadata jsonb; ack jsonb; device uuid; original_id uuid;
begin
 if has_function_privilege('anon','public.finalize_screenshot_capture(uuid,jsonb)','EXECUTE') then raise exception 'Anonymous RPC allowed'; end if;
 if (select prosecdef from pg_proc where oid='public.finalize_screenshot_capture(uuid,jsonb)'::regprocedure) then raise exception 'RPC bypasses RLS'; end if;
 set local role authenticated;
 metadata:=screenshot_test_payload(cap);
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata),'SCREENSHOT_DEVICE_UNAUTHORIZED');
 device:=public.enroll_tracker_device('fixture','test');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata),'SCREENSHOT_OBJECT_REQUIRED');
 insert into storage.objects(bucket_id,name,metadata) values('monitoring',metadata->>'storage_path','{"size":1024}');
 ack:=public.finalize_screenshot_capture(cap,metadata);
 if ack<>jsonb_build_object('success',true,'capture_id',cap,'storage_path',metadata->>'storage_path') then raise exception 'Unexpected receipt'; end if;
 select id into original_id from screenshots where capture_id=cap;
 -- Consume the last Free count slot, then retry without an INSERT.
 insert into storage.objects(bucket_id,name,metadata) values('monitoring',screenshot_test_payload(cap2)->>'storage_path','{"size":1024}');
 perform public.finalize_screenshot_capture(cap2,screenshot_test_payload(cap2));
 if public.finalize_screenshot_capture(cap,metadata)<>ack then raise exception 'Replay changed receipt'; end if;
 if (select count(*) from screenshots)<>2 or (select id from screenshots where capture_id=cap)<>original_id then raise exception 'Replay duplicated capture'; end if;
 insert into storage.objects(bucket_id,name,metadata) values('monitoring',screenshot_test_payload(cap3)->>'storage_path','{"size":1024}');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap3,screenshot_test_payload(cap3)),'PLAN_LIMIT_REACHED');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"width":1280}'),'SCREENSHOT_CAPTURE_CONFLICT');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"created_at":"2000-01-01"}'),'SCREENSHOT_METADATA_UNKNOWN_FIELD');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"organization_id":"00000000-0000-0000-0000-000000000001"}'),'SCREENSHOT_IDENTITY_MISMATCH');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"storage_path":"elsewhere/capture.png"}'),'SCREENSHOT_PATH_INVALID');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"public_url":"https://public.test/file"}'),'SCREENSHOT_PATH_INVALID');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"width":1.5}'),'SCREENSHOT_METADATA_INVALID');
 perform expect_rejected(format('update screenshots set capture_metadata=''{}'' where capture_id=%L',cap),'SCREENSHOT_CAPTURE_RECEIPT_IMMUTABLE');
 perform expect_rejected(format('insert into screenshots(organization_id,developer_id,developer_email,filename,storage_path,width,height,size_kb,mime_type,app_active,is_annotated,annotation_text,timestamp,capture_id,capture_metadata) select organization_id,developer_id,developer_email,filename,storage_path,width,height,size_kb,mime_type,app_active,is_annotated,annotation_text,timestamp,%L,capture_metadata||''{"width":400}'' from screenshots where capture_id=%L',cap3,cap),'SCREENSHOT_CAPTURE_RECEIPT_INVALID');

 perform expect_rejected(format('update screenshots set width=400 where capture_id=%L',cap),'SCREENSHOT_CAPTURE_RECEIPT_IMMUTABLE');
 update screenshots set annotation_text='reviewed' where capture_id=cap;
 if public.finalize_screenshot_capture(cap,metadata)<>ack then raise exception 'Annotation invalidated capture receipt'; end if;
 -- Lost object must not be acknowledged even when metadata was committed.
 reset role;
 delete from storage.objects where name=metadata->>'storage_path';
 set local role authenticated;
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata),'SCREENSHOT_OBJECT_REQUIRED');
 reset role;
 insert into storage.objects(bucket_id,name,metadata) values('monitoring',metadata->>'storage_path','{"size":1024}');
 set local role authenticated;
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"height":16385}'),'SCREENSHOT_METADATA_INVALID');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"timestamp":"infinity"}'),'SCREENSHOT_METADATA_INVALID');
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata||'{"size_kb":2}'),'SCREENSHOT_OBJECT_SIZE_INVALID');
 perform public.revoke_tracker_device(device);
 perform expect_rejected(format('select finalize_screenshot_capture(%L,%L)',cap,metadata),'SCREENSHOT_DEVICE_UNAUTHORIZED');
 reset role;
end; $$;
