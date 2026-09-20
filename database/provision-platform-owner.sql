-- Run after the platform_owner_console migration in the intended project.
-- This account was explicitly approved by the product owner.
begin;
do $$
declare owner_id uuid;
begin
 select id into owner_id from auth.users
 where id='3accddba-fc52-4871-8ae2-699461606aab'
   and lower(email)='zohaibawan6511@gmail.com'
   and email_confirmed_at is not null and deleted_at is null
   and (banned_until is null or banned_until<=now());
 if owner_id is null then
  raise exception 'The confirmed verified owner account was not found in this project';
 end if;
 insert into app_private.platform_owners(auth_user_id) values(owner_id)
 on conflict(auth_user_id) do nothing;
end $$;
commit;
