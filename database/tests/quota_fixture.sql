-- ISOLATED test database only: deliberately minimal application schema.
create role anon;
-- authenticated role is created by the preceding isolation suite.
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function public.auth_org() returns uuid language sql stable as $$ select nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid $$;
create table organizations(id uuid primary key);
create table billing_plans(code text primary key, limits jsonb, features jsonb);
create table organization_subscriptions(organization_id uuid primary key references organizations on delete cascade, plan_code text, status text, trial_end timestamptz, grace_period_ends_at timestamptz, last_payment_status text, current_period_end timestamptz);
create table projects(id uuid primary key default gen_random_uuid(), organization_id uuid references organizations on delete cascade, name text);
create table developer_tasks(id uuid primary key default gen_random_uuid(), organization_id uuid references organizations on delete cascade, status text);
create table memberships(id uuid primary key default gen_random_uuid(), organization_id uuid references organizations on delete cascade, user_type text);
create table developers(id uuid primary key default gen_random_uuid(), organization_id uuid references organizations on delete cascade);
-- Integer id deliberately exercises legacy monitoring schemas too.
create table screenshots(id bigint generated always as identity primary key, organization_id uuid references organizations on delete cascade);
insert into organizations values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into billing_plans values
('free','{"employees":2,"developers":2,"projects":2,"active_tasks":2,"screenshots":2,"storage_mb":1,"tracking_history_days":7}', '{"reports":false,"automation":false,"client_portal":false,"api_access":false}'),
('professional','{"employees":4,"developers":4,"projects":4,"active_tasks":4,"screenshots":4,"storage_mb":2,"tracking_history_days":90}', '{"reports":true,"automation":true,"client_portal":true,"api_access":false}'),
('enterprise','{"employees":-1,"developers":-1,"projects":-1,"active_tasks":-1,"screenshots":-1,"storage_mb":-1,"tracking_history_days":-1}', '{"reports":true,"automation":true,"client_portal":true,"api_access":false}');
grant usage on schema public,auth to authenticated;
grant select,insert,update,delete on projects,developer_tasks,memberships,developers,screenshots to authenticated;
grant usage on all sequences in schema public to authenticated;

create function public.expect_rejected(command text, expected text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlerrm like expected || '%' then return; end if;
    raise;
  end;
  raise exception 'Expected rejection %, statement succeeded: %', expected, command;
end; $$;
