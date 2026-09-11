create function public.auth_is_client() returns boolean language sql stable as $$ select coalesce(auth.jwt()->'app_metadata'->>'user_type'='client',false) $$;
create table employee_profiles(id uuid primary key default gen_random_uuid(),organization_id uuid,user_id uuid,user_type text,membership_id uuid,employment_status text,team_id uuid,weekly_hours numeric,designation text,updated_at timestamptz);
alter table memberships add column reports_to uuid,add column updated_at timestamptz;
create or replace function public.auth_override(p_key text) returns boolean language sql stable as $$ select (auth.jwt()->'test_overrides'->>p_key)::boolean $$;
alter table organizations enable row level security;
alter table memberships enable row level security;
alter table employee_profiles enable row level security;
create policy fixture_org_read on organizations for select to authenticated using(id=public.auth_org());
create policy fixture_members_read on memberships for select to authenticated using(organization_id=public.auth_org());
create policy fixture_employee_read on employee_profiles for select to authenticated using(organization_id=public.auth_org());
grant select,update on organizations,employee_profiles to authenticated;
insert into employee_profiles(id,organization_id,user_id,user_type,employment_status,weekly_hours,designation) values('00000000-0000-0000-0000-000000000077','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012','developer','active',40,'Engineer');

create table change_requests(id uuid primary key default gen_random_uuid(),organization_id uuid,pm_notes text);
alter table change_requests enable row level security;
grant select,insert,update,delete on change_requests to authenticated;
create policy fixture_change_requests on change_requests for all to authenticated using(organization_id=public.auth_org()) with check(organization_id=public.auth_org());
insert into change_requests(organization_id,pm_notes) values('00000000-0000-0000-0000-000000000002','Private pricing discussion');
