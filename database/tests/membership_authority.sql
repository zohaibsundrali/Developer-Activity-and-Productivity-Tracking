select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000099","email":"owner@example.com","app_metadata":{"role":"owner","user_type":"admin","app_user_id":"00000000-0000-0000-0000-000000000011","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
set role authenticated;
do $$ begin
  if public.auth_role() is distinct from 'owner' or public.auth_org() is null then raise exception 'Active member refused'; end if;
  if (select count(*) from memberships) <> 1 then raise exception 'Recursive RLS lookup failed'; end if;
end $$;
reset role;
update memberships set role = 'employee';
set role authenticated;
do $$ begin
  if public.auth_role() is distinct from 'employee' then raise exception 'Stale owner token retained role'; end if;
end $$;
reset role;
update memberships set status = 'suspended';
set role authenticated;
do $$ begin
  if public.auth_org() is not null or public.auth_role() is not null then raise exception 'Suspended member retained access'; end if;
  if (select count(*) from notifications) <> 0 then raise exception 'Suspended member read inbox'; end if;
end $$;
reset role;
update memberships set status = 'active', role = 'owner';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000099","app_metadata":{"role":"employee","user_type":"admin","app_user_id":"00000000-0000-0000-0000-000000000011","organization_id":"00000000-0000-0000-0000-000000000001"}}', false);
set role authenticated;
do $$ begin
  if public.auth_role() is distinct from 'employee' then raise exception 'Claim-first demotion was undone'; end if;
end $$;
reset role;
delete from memberships;
set role authenticated;
do $$ begin
  if public.auth_org() is not null or public.auth_role() is not null then raise exception 'Removed member retained access'; end if;
end $$;
reset role;
