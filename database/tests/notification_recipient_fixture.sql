-- Isolated PostgreSQL fixture only. Do not run against a deployed application.
create role authenticated;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
create function public.auth_org() returns uuid language sql stable as $$ select (auth.jwt()->'app_metadata'->>'organization_id')::uuid $$;
create function public.auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->'app_metadata'->>'app_user_id')::uuid $$;
grant usage on schema auth to authenticated;
create table public.notifications (id int primary key, organization_id uuid, admin_id text, admin_email text, developer_id uuid, assigned_developer_id uuid, read boolean default false, read_at timestamptz, title text default 'Original', metadata jsonb default '{}'::jsonb);
grant select, update on public.notifications to authenticated;
alter table public.notifications enable row level security;
-- A forgotten legacy grant must not bypass the new restrictive policies.
create policy legacy_all on public.notifications for all to authenticated using (true) with check (true);
insert into public.notifications(id,organization_id,admin_id,admin_email,developer_id) values
(1,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,null),
(2,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012',null,null),
(3,'00000000-0000-0000-0000-000000000001',null,'OWNER@example.com',null),
(4,'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000011',null,null),
(5,'00000000-0000-0000-0000-000000000001',null,null,'00000000-0000-0000-0000-000000000013'),
(6,'00000000-0000-0000-0000-000000000001',null,null,'00000000-0000-0000-0000-000000000014');

-- An HR/manager-style admin-console notification addressed to a staff profile.
insert into notifications(id,organization_id,admin_id) values (7,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013');
