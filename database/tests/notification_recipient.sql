-- Run after the fixture and migration in an isolated database; exits on failure.
set role authenticated;
select set_config('request.jwt.claims', '{"email":"owner@example.com","app_metadata":{"role":"owner","user_type":"admin","app_user_id":"00000000-0000-0000-0000-000000000011","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
do $$ declare n int; begin
  if (select array_agg(id order by id) from notifications) <> array[1,3] then raise exception 'Owner inbox leaked or lost rows'; end if;
  update notifications set read = true where id = 2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Owner updated another recipient'; end if;
  update notifications set read = true where id = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Owner cannot mark own notification read'; end if;
  begin
    update notifications set admin_id = '00000000-0000-0000-0000-000000000012' where id = 1;
    raise exception 'Recipient reassignment was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"email":"dev@example.com","app_metadata":{"role":"developer","user_type":"developer","app_user_id":"00000000-0000-0000-0000-000000000013","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
do $$ begin
  if (select array_agg(id order by id) from notifications) <> array[5,7] then raise exception 'Developer inbox leaked or lost rows'; end if;
end $$;
select set_config('request.jwt.claims', '{"email":"owner@example.com","app_metadata":{"role":"owner","user_type":"client","app_user_id":"00000000-0000-0000-0000-000000000011","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
do $$ begin
  if (select count(*) from notifications) <> 0 then raise exception 'Client acquired staff inbox'; end if;
end $$;
reset role;
