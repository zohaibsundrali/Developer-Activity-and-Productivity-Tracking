\set ON_ERROR_STOP on
\ir task_authorization_fixture.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
alter table memberships add column id uuid default gen_random_uuid(),add column email text,add column reports_to uuid;
alter table user_permissions add column membership_id uuid;
create table developers(id uuid,email text);
create table admin_users(id uuid,email text);
create table project_members(project_id uuid,organization_id uuid,user_id uuid,user_type text,project_role text);
drop function auth_override(text);
\ir ../../supabase/migrations/20260911072728_production_typed_permission_identity.sql
create schema storage;
create table storage.buckets(id text,public boolean);
insert into storage.buckets values('monitoring',false);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
create schema app_private;
create function app_private.plan_limit(uuid,text) returns bigint language sql stable as $$ select 30::bigint $$;
create table productivity_sessions(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table productivity_sessions enable row level security;
create table keyboard_stats(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table keyboard_stats enable row level security;
create table mouse_activities(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table mouse_activities enable row level security;
create table app_usage(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table app_usage enable row level security;
create table screenshots(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table screenshots enable row level security;
create table developer_logins(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table developer_logins enable row level security;
create table browser_usage(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table browser_usage enable row level security;
create table developer_activities(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table developer_activities enable row level security;
create table activity_logs(id int,organization_id uuid,developer_id uuid,developer_email text,created_at timestamptz default now());
alter table activity_logs enable row level security;
\ir ../040_monitoring_access.sql
\ir ../044_activity_logs_access.sql
-- Exact production history function/policies from060849; only plan_limit is
-- fixture-injected to30days. Preserve genuine retention alongside read rules.
create or replace function public.auth_tracking_history(p_org uuid, p_row jsonb) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app_private
as $$
declare days bigint; recorded timestamptz;
begin
  if p_org is distinct from public.auth_org() or p_org is null then return false; end if;
  days := app_private.plan_limit(p_org,'tracking_history_days');
  if days=-1 then return true; end if;
  -- Monitoring tables have historical timestamp names; use only server-stored
  -- columns, not an API caller's requested range. Unknown timestamps fail closed.
  recorded := coalesce(nullif(p_row->>'timestamp',''), nullif(p_row->>'tracked_at',''), nullif(p_row->>'start_time',''),
    nullif(p_row->>'session_start',''), nullif(p_row->>'login_time',''), nullif(p_row->>'created_at',''))::timestamptz;
  return coalesce(recorded >= now() - make_interval(days => least(days,2147483647)::integer),false);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end; $$;
revoke all on function public.auth_tracking_history(uuid,jsonb) from public;
grant execute on function public.auth_tracking_history(uuid,jsonb) to authenticated;

do $$
declare tbl text;
begin
  foreach tbl in array array['productivity_sessions','keyboard_stats','mouse_activities','app_usage',
    'screenshots','developer_logins','browser_usage','developer_activities','activity_logs']
  loop
    if to_regclass('public.'||tbl) is null then continue; end if;
    execute format('alter table public.%I enable row level security',tbl);
    execute format('drop policy if exists tracking_history_access on public.%I',tbl);
    execute format('create policy tracking_history_access on public.%I as restrictive for select to authenticated using
      (public.auth_tracking_history(organization_id,to_jsonb(%I)))',tbl,tbl);
  end loop;
end; $$;
grant usage on schema storage to authenticated;
grant select on all tables in schema public,storage to authenticated;
-- A forgotten permissive policy must not bypass the new restrictive guard.
create policy legacy_wide on activity_logs for select to authenticated using(true);
create policy legacy_storage_wide on storage.objects for select to authenticated using(true);
\ir ../../supabase/migrations/20260911130517_production_typed_monitoring_read_permissions.sql
insert into memberships(organization_id,user_id,user_type,role,status,email) values
 ('76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011','developer','developer','active','own@example.test'),
 ('76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011','admin','hr','active','hr@example.test'),
 ('76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000012','developer','developer','active','other@example.test'),
 ('76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000013','admin','owner','active','owner@example.test'),
 ('76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000014','client','client','active','client@example.test');
do $$ declare tbl text; begin
 foreach tbl in array array['productivity_sessions','keyboard_stats','mouse_activities','app_usage','screenshots','developer_logins','browser_usage','developer_activities','activity_logs'] loop
 execute format('insert into %I(id,organization_id,developer_id,developer_email,created_at) values
 (1,''76000000-0000-0000-0000-000000000001'',''76000000-0000-0000-0000-000000000011'',null,now()),
 (2,''76000000-0000-0000-0000-000000000001'',null,''own@example.test'',now()),
 (3,''76000000-0000-0000-0000-000000000001'',''76000000-0000-0000-0000-000000000012'',null,now()),
 (4,''76000000-0000-0000-0000-000000000001'',''76000000-0000-0000-0000-000000000012'',''own@example.test'',now()),
 (5,''76000000-0000-0000-0000-000000000001'',''76000000-0000-0000-0000-000000000011'',null,now()-interval ''60 days''),
 (6,''76000000-0000-0000-0000-000000000002'',''76000000-0000-0000-0000-000000000011'',null,now()),
 (7,''76000000-0000-0000-0000-000000000001'',null,null,now())',tbl);
 end loop;
end $$;
insert into storage.objects(bucket_id,name,created_at) values
 ('monitoring','76000000-0000-0000-0000-000000000001/76000000-0000-0000-0000-000000000011/own.png',now()),
 ('monitoring','76000000-0000-0000-0000-000000000001/76000000-0000-0000-0000-000000000012/other.png',now()),
 ('monitoring','76000000-0000-0000-0000-000000000001/76000000-0000-0000-0000-000000000011/old.png',now()-interval '60 days'),
 ('monitoring','76000000-0000-0000-0000-000000000002/76000000-0000-0000-0000-000000000011/foreign.png',now());
create function monitoring_assert_counts(expected int,objects int) returns void language plpgsql security invoker as $$ declare tbl text; actual int; begin
 foreach tbl in array array['productivity_sessions','keyboard_stats','mouse_activities','app_usage','screenshots','developer_logins','browser_usage','developer_activities','activity_logs'] loop
 execute format('select count(*) from %I',tbl) into actual;
 if actual<>expected then raise exception 'Bulk SELECT % expected%, got%',tbl,expected,actual; end if;
 end loop;
 if (select count(*) from storage.objects)<>objects then raise exception 'Storage permission/retention wrong'; end if;
end $$;
do $$ declare org uuid:='76000000-0000-0000-0000-000000000001'; actor uuid:='76000000-0000-0000-0000-000000000011'; begin
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 perform monitoring_assert_counts(2,1);
 reset role;
 insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select actor,'developer','monitoring.view_own',false,id from memberships where user_id=actor and user_type='developer';
 set local role authenticated; perform monitoring_assert_counts(0,0); reset role;
 insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select actor,'developer','monitoring.view',true,id from memberships where user_id=actor and user_type='developer';
 set local role authenticated; perform monitoring_assert_counts(5,2); reset role;
 -- Same UUID admin profile cannot inherit developer data or developer grants.
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated; perform monitoring_assert_counts(0,0); reset role;
 insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select actor,'admin','monitoring.view',true,id from memberships where user_id=actor and user_type='admin';
 set local role authenticated; perform monitoring_assert_counts(5,2); reset role;
 update memberships set status='suspended' where user_id=actor and user_type='admin';
 set local role authenticated; perform monitoring_assert_counts(0,0); reset role;
 -- Explicit denial overrides owner default.
 actor:='76000000-0000-0000-0000-000000000013';
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','admin','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated; perform monitoring_assert_counts(5,2); reset role;
 insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select actor,'admin','monitoring.view',false,id from memberships where user_id=actor and user_type='admin';
 set local role authenticated; perform monitoring_assert_counts(0,0); reset role;
 actor:='76000000-0000-0000-0000-000000000014';
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','client','app_metadata',jsonb_build_object('user_type','client'))::text,true);
 set local role authenticated; perform monitoring_assert_counts(0,0); reset role;
 -- Legacy email ambiguity never chooses an arbitrary profile.
 actor:='76000000-0000-0000-0000-000000000011';
 delete from user_permissions where user_id=actor;
 update memberships set email='own@example.test' where user_id=actor and user_type='admin';
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated; perform monitoring_assert_counts(1,1); reset role;
end $$;
-- Legacy hierarchy still serves unrelated consumers; it cannot widen monitoring.
do $$ declare org uuid:='76000000-0000-0000-0000-000000000001'; actor uuid:='76000000-0000-0000-0000-000000000011'; begin
 update memberships set role='manager' where user_id=actor and user_type='developer';
 update memberships set reports_to=actor where user_id='76000000-0000-0000-0000-000000000012';
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',actor,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 if cardinality(auth_monitoring_subjects())<>2 then raise exception 'Shared hierarchy helper changed'; end if;
 perform monitoring_assert_counts(1,1);
 if auth_monitoring_record_read(org,jsonb_build_object('developer_id',actor,'user_id','76000000-0000-0000-0000-000000000012')) then raise exception 'Conflicting populated identifiers accepted'; end if;
 reset role;
 update memberships set role='finance' where user_id=actor and user_type='developer';
 set local role authenticated; perform monitoring_assert_counts(1,1); reset role;
end $$;
