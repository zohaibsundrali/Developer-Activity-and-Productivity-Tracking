\set ON_ERROR_STOP on
\ir shared_account_billing.sql

-- Simulate the deployed gap, using synthetic local metadata only. Production
-- files are never inserted, updated, moved or deleted through SQL.
drop trigger app_storage_accounting on storage.objects;
drop table app_private.storage_usage;
alter table screenshots add column storage_path text;
alter table storage.objects add column last_accessed_at timestamptz, add column version text;
insert into storage.objects(bucket_id,name,metadata) values
 ('documents','legacy-document.pdf','{"size":400,"eTag":"original-a"}'),
 ('screenshots','former-user/image.png','{"size":600,"eTag":"original-b"}');
create temporary table original_objects as select * from storage.objects;

\ir ../../supabase/migrations/20260921062832_restore_storage_usage_ledger.sql
\ir ../../supabase/migrations/20260921065334_support_storage_upload_permission_probe.sql

do $$ declare anchor uuid; child uuid; known uuid; legacy uuid; new_object uuid; begin
 if exists((select * from storage.objects except select * from original_objects)
   union all (select * from original_objects except select * from storage.objects)) then
  raise exception 'Repair changed original storage metadata';
 end if;
 if (select count(*) from app_private.storage_legacy_unassigned)<>2
  or (select sum(bytes) from app_private.storage_legacy_unassigned)<>1000 then
  raise exception 'Legacy inventory is incomplete';
 end if;
 if exists(select 1 from app_private.storage_legacy_unassigned l join app_private.storage_usage u using(object_id)) then
  raise exception 'Unattributed file charged to a tenant';
 end if;
 if has_table_privilege('anon','app_private.storage_legacy_unassigned','SELECT')
  or has_table_privilege('authenticated','app_private.storage_legacy_unassigned','SELECT')
  or has_table_privilege('service_role','app_private.storage_legacy_unassigned','SELECT') then
  raise exception 'Legacy inventory exposed';
 end if;
 select id into legacy from storage.objects where name='legacy-document.pdf';
 perform expect_rejected(format('delete from storage.objects where id=%L',legacy),'STORAGE_LEGACY_READ_ONLY');
 perform expect_rejected(format('update storage.objects set name=''renamed'' where id=%L',legacy),'STORAGE_LEGACY_READ_ONLY');
 perform expect_rejected(format('update storage.objects set metadata=''{"size":1}'' where id=%L',legacy),'STORAGE_LEGACY_READ_ONLY');
 update storage.objects set last_accessed_at=now() where id=legacy;
 perform expect_rejected('insert into storage.objects(bucket_id,name,metadata) values(''documents'',''new-unmapped.pdf'',''{"size":1}'')','STORAGE_MAPPING_REQUIRED');

 select b.account_id,b.organization_id into anchor,child from app_private.organization_billing b
  join organizations o on o.id=b.organization_id where o.name='Shared child';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if public.organization_storage_usage(anchor)<>1048576 or public.organization_storage_usage(child)<>1048576 then
  raise exception 'Mapped shared-account storage totals changed';
 end if;
 perform expect_rejected(format('insert into storage.objects(bucket_id,name,metadata) values(''org-files'',%L,''{"size":1}'')',child||'/above-quota'),'PLAN_LIMIT_REACHED');
 -- Pre-upload checks can run at a full quota but never finalize an oversized file.
 insert into storage.objects(bucket_id,name,metadata,version)
  values('org-files',child||'/probe','{"mimetype":"text/plain","contentLength":9999999}','1') returning id into new_object;
 perform expect_rejected(format('update storage.objects set version=%L,metadata=''{"size":1}'' where id=%L',gen_random_uuid()::text,new_object),'PLAN_LIMIT_REACHED');
 perform expect_rejected(format('update storage.objects set version=%L where id=%L',gen_random_uuid()::text,new_object),'STORAGE_SIZE_UNAVAILABLE');
 delete from storage.objects where id=new_object;
 select id into known from storage.objects where name=anchor||'/one';
 update storage.objects set metadata='{"size":524000}' where id=known;
 insert into storage.objects(bucket_id,name,metadata) values('org-files',child||'/new-valid','{"size":200}') returning id into new_object;
 if public.organization_storage_usage(child)<>1048488 then raise exception 'New uploads not accounted'; end if;
 delete from storage.objects where id=new_object;
 if public.organization_storage_usage(anchor)<>1048288 then raise exception 'New upload cleanup not accounted'; end if;
 perform set_config('request.jwt.claims','{}',true);
 perform expect_rejected(format('select public.organization_storage_usage(%L)',anchor),'Unauthorized');
end $$;
select 'Preserved legacy storage, immutable inventory, billing and quota tests passed' result;
