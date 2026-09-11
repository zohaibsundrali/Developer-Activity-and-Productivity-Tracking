set role authenticated;
select set_config('request.jwt.claims', '{"email":"owner@example.com","app_metadata":{"role":"owner","user_type":"admin","app_user_id":"00000000-0000-0000-0000-000000000011","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
do $$ begin
  update notifications set read = true, read_at = now() where id = 1;
  begin
    update notifications set title = 'Forged message' where id = 1;
    raise exception 'Owner rewrote notification content';
  exception when insufficient_privilege then null; end;
  begin
    update notifications set developer_id = '00000000-0000-0000-0000-000000000013' where id = 1;
    raise exception 'Owner added a second recipient';
  exception when insufficient_privilege then null; end;
  begin
    update notifications set metadata = '{"redirect":"forged"}' where id = 1;
    raise exception 'Owner changed an unenumerated column';
  exception when insufficient_privilege then null; end;
  update notifications set read = false, read_at = null where id = 1;
end $$;
select set_config('request.jwt.claims', '{"email":"owner@example.com","app_metadata":{"role":"admin","user_type":"admin","app_user_id":"00000000-0000-0000-0000-000000000011","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
do $$ begin
  begin
    update notifications set title = 'Admin edit' where id = 1;
    raise exception 'Admin exemption remains';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"email":"dev@example.com","app_metadata":{"role":"developer","user_type":"developer","app_user_id":"00000000-0000-0000-0000-000000000013","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
do $$ begin
  update notifications set read = true, read_at = now() where id = 5;
  begin
    update notifications set metadata = '{"redirect":"forged"}' where id = 5;
    raise exception 'Developer changed an unenumerated column';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update notifications set title = 'Maintained' where id = 1;
do $$ begin
  if (select title from notifications where id = 1) <> 'Maintained' then
    raise exception 'Trusted maintenance blocked';
  end if;
end $$;
