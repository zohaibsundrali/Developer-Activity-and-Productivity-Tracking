-- Run in the same isolated database after notification_recipient_fixture.sql.
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create table memberships (organization_id uuid, user_id uuid, user_type text, role text, status text);
alter table memberships enable row level security;
grant select on memberships to authenticated;
create policy members_read on memberships to authenticated using (organization_id = public.auth_org());
insert into memberships values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','owner','active');
create or replace function public.role_rank(p_role text)
returns integer language sql immutable
set search_path = public, pg_temp
as $$
  select case p_role
    when 'owner'     then 100
    when 'admin'     then 90
    when 'manager'   then 70
    when 'hr'        then 60
    when 'finance'   then 55
    when 'team_lead' then 50
    when 'qa'        then 35
    when 'developer' then 30
    when 'designer'  then 30
    when 'devops'    then 30
    when 'employee'  then 20
    when 'client'    then 10
    else null
  end
$$;
