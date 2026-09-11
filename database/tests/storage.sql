do $$
declare org uuid := '00000000-0000-0000-0000-000000000002'; obj uuid; used bigint;
begin
  -- Free: exactly 1 MiB including backfilled files.
  update organization_subscriptions set status='canceled' where organization_id=org;
  insert into storage.objects(bucket_id,name,metadata) values ('monitoring',org||'/dev/image.png','{"size":524288}') returning id into obj;
  perform expect_rejected(format('insert into storage.objects(bucket_id,name,metadata) values (''org-files'',%L,''{"size":1}'')',org||'/documents/extra.pdf'),'PLAN_LIMIT_REACHED');
  perform expect_rejected(format('update storage.objects set metadata=''{"size":524289}'' where id=%L',obj),'PLAN_LIMIT_REACHED');
  update storage.objects set metadata='{"size":1}' where id=obj;
  insert into storage.objects(bucket_id,name,metadata) values ('org-files',org||'/documents/new.pdf','{"size":100}');
  perform expect_rejected('insert into storage.objects(bucket_id,name,metadata) values (''documents'',''unknown.pdf'',''{"size":1}'')','STORAGE_MAPPING_REQUIRED');
  perform expect_rejected(format('insert into storage.objects(bucket_id,name,metadata) values (''org-files'',%L,''{"size":-1}'')',org||'/documents/invalid.pdf'),'STORAGE_SIZE_UNAVAILABLE');
  -- Storage's two-step finalization must not bypass the ceiling.
  insert into storage.objects(bucket_id,name,metadata) values ('org-files',org||'/documents/uploading.pdf',null) returning id into obj;
  perform expect_rejected(format('update storage.objects set metadata=''{"size":1048576}'' where id=%L',obj),'PLAN_LIMIT_REACHED');
  delete from storage.objects where id=obj;
  select sum(bytes) into used from app_private.storage_usage where organization_id=org;
  if used<>524389 then raise exception 'Storage accounting mismatch: %',used; end if;
  update organization_subscriptions set status='active' where organization_id=org;
  insert into storage.objects(bucket_id,name,metadata) values ('org-files',org||'/documents/upgraded.pdf','{"size":1048576}');
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000011","app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","user_type":"admin"}}',true);
  set local role authenticated;
  if public.organization_storage_usage(org)<>1572965 then raise exception 'Usage RPC mismatch'; end if;
  perform expect_rejected('select public.organization_storage_usage(''00000000-0000-0000-0000-000000000001'')','Unauthorized');
  reset role;
end; $$;
