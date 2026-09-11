select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000011","session_id":"00000000-0000-0000-0000-000000000021","email":"dev@example.test","app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","app_user_id":"00000000-0000-0000-0000-000000000012","user_type":"developer","role":"developer"}}',false);
do $$
declare device uuid; again uuid; org uuid := '00000000-0000-0000-0000-000000000002';
begin
  set local role authenticated;
  if public.auth_tracker_session() then raise exception 'Unenrolled session accepted'; end if;
  device:=public.enroll_tracker_device('Laptop','Windows');
  again:=public.enroll_tracker_device('Laptop','Windows');
  if device<>again then raise exception 'Repeated enrollment created duplicate device'; end if;
  if not public.auth_tracker_session() then raise exception 'Enrolled session refused'; end if;
  insert into screenshots(organization_id,developer_id,developer_email) values(org,'00000000-0000-0000-0000-000000000012','dev@example.test');
  perform expect_rejected(format('insert into screenshots(organization_id,developer_id) values(%L,''00000000-0000-0000-0000-000000000099'')',org),'new row violates row-level security');
  perform expect_rejected(format('insert into screenshots(organization_id,developer_id,developer_email) values(%L,''00000000-0000-0000-0000-000000000012'',''other@example.test'')',org),'new row violates row-level security');
  insert into storage.objects(bucket_id,name,metadata) values('monitoring',org||'/00000000-0000-0000-0000-000000000012/enrolled.png','{"size":1}');
  perform expect_rejected(format('insert into storage.objects(bucket_id,name,metadata) values(''monitoring'',%L,''{"size":1}'')',org||'/00000000-0000-0000-0000-000000000099/forged.png'),'new row violates row-level security');
  if not public.revoke_tracker_device(device) then raise exception 'Revocation failed'; end if;
  if public.auth_tracker_session() then raise exception 'Revoked session accepted'; end if;
  perform expect_rejected('select public.enroll_tracker_device(''Laptop'',''Windows'')','Device session expired or revoked');
  perform expect_rejected(format('insert into screenshots(organization_id,developer_id) values(%L,''00000000-0000-0000-0000-000000000012'')',org),'new row violates row-level security');
  reset role;
end; $$;

-- Signing a known historical object path is subject to the plan window too.
do $$ declare org uuid:='00000000-0000-0000-0000-000000000002'; visible integer; begin
  insert into storage.objects(bucket_id,name,metadata,created_at) values
    ('monitoring',org||'/00000000-0000-0000-0000-000000000012/old.png','{"size":1}',now()-interval '100 days');
  set local role authenticated;
  select count(*) into visible from storage.objects where name like '%/old.png';
  if visible<>0 then raise exception 'Known storage path bypassed tracking history'; end if;
  reset role;
end; $$;
