-- Standalone isolated PostgreSQL fixture; never run on a deployed database.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls;
create schema auth;
-- Production migration must bootstrap its own private schema.
create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
create function public.auth_org() returns uuid language sql stable as $$ select (auth.jwt()->'app_metadata'->>'organization_id')::uuid $$;
create function public.auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->'app_metadata'->>'app_user_id')::uuid $$;
grant usage on schema auth to authenticated;
create table organizations(id uuid primary key);
create table projects(id uuid primary key,organization_id uuid,created_by uuid,added_by uuid);
create table memberships(organization_id uuid, user_id uuid,user_type text,email text,status text,unique(organization_id,user_id,user_type));
create table notifications(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),admin_id text,admin_email text,developer_id uuid,assigned_developer_id uuid,category text,read boolean default false,read_at timestamptz,title text);
create table notification_preferences(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,user_type text,category text,enabled boolean default true);
create unique index uq_notification_prefs_user_category on notification_preferences(user_id,category);
alter table notifications enable row level security;
alter table notification_preferences enable row level security;
grant select,insert,update,delete on notifications,notification_preferences to authenticated;
grant all on notifications,notification_preferences to service_role;
create policy notifications_legacy on notifications for all to authenticated using (true) with check (true);
create policy preferences_legacy on notification_preferences for all to authenticated using (true) with check (true);
insert into organizations values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into memberships values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin','admin@test.dev','active'),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','developer','developer@test.dev','active'),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','developer','manager@test.dev','active'),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013','developer','inactive@test.dev','suspended'),
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000014','developer','other@test.dev','active');
insert into notifications(id,organization_id,admin_id,admin_email,developer_id,title) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',null,null,'ambiguous'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','ADMIN@test.dev',null,'admin'),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',null,null,'00000000-0000-0000-0000-000000000011','developer'),
('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012',null,null,'manager admin address'),
('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',null,'manager@test.dev',null,'manager email'),
('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin@test.dev','00000000-0000-0000-0000-000000000012','multi');
