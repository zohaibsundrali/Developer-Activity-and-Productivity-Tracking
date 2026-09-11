-- Standalone schema for task authorization, no live data.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->>'user')::uuid $$;
create table memberships(organization_id uuid,user_id uuid,user_type text,role text,status text,primary key(organization_id,user_id,user_type));
create table user_permissions(user_id uuid,user_type text,permission_key text,allowed boolean);
create function auth_org() returns uuid language sql stable security definer set search_path=public as $$ select organization_id from memberships where user_id=auth_app_user_id() and user_type=auth.jwt()->>'type' and organization_id=(auth.jwt()->>'org')::uuid and status='active' $$;
create function auth_role() returns text language sql stable security definer set search_path=public as $$ select role from memberships where user_id=auth_app_user_id() and user_type=auth.jwt()->>'type' and organization_id=auth_org() $$;
create function auth_override(k text) returns boolean language sql stable security definer set search_path=public as $$ select allowed from user_permissions where user_id=auth_app_user_id() and user_type=auth.jwt()->>'type' and permission_key=k $$;
create function auth_is_client() returns boolean language sql stable as $$ select auth.jwt()->>'type'='client' $$;
create function auth_plan_feature(k text) returns boolean language sql stable as $$ select coalesce(current_setting('test.client_feature',true),'yes')='yes' $$;
create table projects(id uuid primary key,organization_id uuid,assigned_developer_id uuid,task_plan_submitted boolean default false,task_plan_status text);
create table project_clients(project_id uuid,client_id uuid);
create function auth_client_project_ids() returns setof uuid language sql stable security definer set search_path=public as $$ select project_id from project_clients where client_id=auth_app_user_id() $$;
create table developer_tasks(id uuid primary key default gen_random_uuid(),organization_id uuid,project_id uuid references projects on delete cascade,
  developer_id uuid,task_type text default 'feature',client_visible boolean default false,status text default 'pending',
  task_title text,task_description text,start_date date,end_date date,task_order int,updated_at timestamptz,
  severity text,steps_to_reproduce text,environment text,reported_by uuid,priority text default 'medium',
  reviewed_by uuid,reviewed_at timestamptz,admin_comments text,rejection_reason text,is_on_time boolean,
  productivity_points int default 0,actual_completion_date date,submitted_at timestamptz);
grant usage on schema public,auth to authenticated,service_role;
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
alter table developer_tasks enable row level security;
create policy legacy_all on developer_tasks for all to authenticated using(true) with check(true);
