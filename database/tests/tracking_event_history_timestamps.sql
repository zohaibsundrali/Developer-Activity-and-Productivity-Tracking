do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
\ir quota_fixture.sql
\ir ../../supabase/migrations/20260911055537_production_quota_enforcement.sql
\ir feature_history_fixture.sql
create table keyboard_stats(id int,organization_id uuid,tracked_at timestamptz,created_at timestamptz default now());
create table mouse_activities(id int,organization_id uuid,timestamp timestamptz,created_at timestamptz default now());
create table app_usage(id int,organization_id uuid,app_name text,start_time timestamptz,end_time timestamptz,tracked_at timestamptz default now(),created_at timestamptz default now());
create table browser_usage(id int,organization_id uuid,site text,first_seen timestamptz,last_seen timestamptz,created_at timestamptz default now());
grant select on keyboard_stats,mouse_activities,app_usage,browser_usage to authenticated;
create policy legacy_allow on keyboard_stats for select to authenticated using(true);
create policy legacy_allow on mouse_activities for select to authenticated using(true);
create policy legacy_allow on app_usage for select to authenticated using(true);
create policy legacy_allow on browser_usage for select to authenticated using(true);
\ir ../../supabase/migrations/20260911060849_production_feature_history_guards.sql
\ir ../../supabase/migrations/20260912094423_production_tracking_event_history_timestamps.sql
select set_config('request.jwt.claims','{"app_metadata":{"organization_id":"00000000-0000-0000-0000-000000000002","user_type":"admin"}}',false);
insert into keyboard_stats values(1,auth_org(),now()-interval '20 days',now()),(2,auth_org(),now(),now());
insert into mouse_activities values(1,auth_org(),now()-interval '20 days',now()),(2,auth_org(),now(),now());
insert into app_usage(id,organization_id,app_name,start_time,end_time) values(1,auth_org(),'Code',now()-interval '20 days',now()-interval '19 days'),(2,auth_org(),'Code',now(),now());
insert into browser_usage(id,organization_id,site,first_seen,last_seen) values(1,auth_org(),'example.com',now()-interval '20 days',now()-interval '19 days'),(2,auth_org(),'example.com',now(),now());
do $$ declare org uuid:=auth_org(); tbl text; n int; rowdata jsonb; stamp timestamptz; begin
 set local role authenticated;
 foreach tbl in array array['keyboard_stats','mouse_activities','app_usage','browser_usage'] loop
  execute format('select count(*) from %I',tbl) into n;
  if n<>1 then raise exception 'Free history leaked %: %',tbl,n; end if;
 end loop;
 if auth_tracking_history(org,jsonb_build_object('app_name','Code','start_time','infinity','tracked_at',now())) then raise exception 'Nonfinite app event exposed'; end if;
 if auth_tracking_history(org,jsonb_build_object('site','example.com','first_seen','invalid','created_at',now())) then raise exception 'Malformed browser event exposed'; end if;
 if not auth_tracking_history(org,jsonb_build_object('site','example.com','first_seen',null,'last_seen',null,'created_at',now())) then raise exception 'Legacy timestamp fallback broken'; end if;
 reset role;
 insert into organization_subscriptions(organization_id,plan_code,status) values(org,'professional','active');
 set local role authenticated;
 foreach tbl in array array['keyboard_stats','mouse_activities','app_usage','browser_usage'] loop
  execute format('select count(*) from %I',tbl) into n;
  if n<>2 then raise exception 'Upgrade failed %',tbl; end if;
 end loop;
 reset role;
 update organization_subscriptions set status='canceled' where organization_id=org;
 set local role authenticated;
 if (select count(*) from browser_usage)<>1 or (select count(*) from app_usage)<>1 then raise exception 'Cancellation retained paid history'; end if;
 reset role;
 update organization_subscriptions set plan_code='enterprise',status='active' where organization_id=org;
 set local role authenticated;
 if not auth_tracking_history(org,jsonb_build_object('site','example.com','first_seen',now()-interval '100 years')) then raise exception 'Unlimited history broken'; end if;
 reset role;
 -- Cleanup dates use end-of-interval; never delete a still-open record.
 select to_jsonb(b) into rowdata from browser_usage b where id=1;
 stamp:=app_private.retention_recorded(rowdata);
 if stamp is distinct from (rowdata->>'last_seen')::timestamptz then raise exception 'Browser retention uses upload time'; end if;
 if app_private.retention_recorded(rowdata||'{"last_seen":null}') is not null then raise exception 'Open browser eligible for deletion'; end if;
 if app_private.retention_recorded(rowdata||'{"last_seen":"invalid"}') is not null then raise exception 'Malformed browser eligible for deletion'; end if;
 if app_private.retention_recorded(rowdata||'{"last_seen":"infinity"}') is not null then raise exception 'Nonfinite browser eligible for deletion'; end if;
 select to_jsonb(a) into rowdata from app_usage a where id=1;
 if app_private.retention_recorded(rowdata) is distinct from (rowdata->>'end_time')::timestamptz then raise exception 'App retention interval changed'; end if;
 if app_private.retention_recorded(rowdata||'{"end_time":null}') is not null then raise exception 'Open app eligible for deletion'; end if;
 foreach tbl in array array['keyboard_stats','mouse_activities','app_usage','browser_usage'] loop
  execute format('select count(*) from %I',tbl) into n;
  if n<>2 then raise exception 'Migration deleted history'; end if;
 end loop;
end $$;
