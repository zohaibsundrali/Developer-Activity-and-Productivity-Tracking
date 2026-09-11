\set ON_ERROR_STOP on
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth_org() returns uuid language sql stable as $$ select (auth.jwt()->>'org')::uuid $$;
create function auth_app_user_id() returns uuid language sql stable as $$ select (auth.jwt()->>'user')::uuid $$;
create function auth_role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create function auth_is_client() returns boolean language sql stable as $$ select auth.jwt()->'app_metadata'->>'user_type'='client' $$;
create function auth_org_unlocked() returns boolean language sql stable as $$ select coalesce(current_setting('test.locked',true),'no')<>'yes' $$;
create function auth_override(k text) returns boolean language sql stable as $$ select (auth.jwt()->'overrides'->>k)::boolean $$;
create table organizations(id uuid primary key,name text default 'Test');
create table memberships(organization_id uuid,user_id uuid,user_type text,role text,status text);
insert into organizations(id) values('91000000-0000-0000-0000-000000000001');
insert into memberships values('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000011','admin','owner','active'),('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000011','developer','developer','active');
\ir ../075_attendance_and_leave.sql
\ir ../../supabase/migrations/20260911180705_production_typed_leave_authority.sql
grant usage on schema auth to authenticated;
grant select on memberships to authenticated;
grant select,insert,update,delete on leave_requests,attendance_records,leave_types to authenticated;
create function leave_expect_denied(q text) returns void language plpgsql security invoker as $$ begin begin execute q; exception when insufficient_privilege or invalid_parameter_value or unique_violation then return; end; raise exception 'Expected denied leave write'; end $$;
do $$ declare org uuid:='91000000-0000-0000-0000-000000000001'; person uuid:='91000000-0000-0000-0000-000000000011'; lt uuid; own_id uuid; other_id uuid; n int; begin
 select id into lt from leave_types limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',person,'role','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(org,person,'developer',lt,'2026-09-14','2026-09-14',0.5) returning id into own_id;
 perform leave_expect_denied(format('insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(%L,%L,''admin'',%L,''2026-09-15'',''2026-09-15'',1)',org,person,lt));
 perform leave_expect_denied(format('insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(%L,%L,''developer'',%L,''2026-09-14'',''2026-09-14'',1)',org,person,lt));
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',person,'role','owner','app_metadata',jsonb_build_object('user_type','admin'))::text,true);
 set local role authenticated;
 insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(org,person,'admin',lt,'2026-09-14','2026-09-14',1) returning id into other_id;
 perform leave_expect_denied(format('update leave_requests set status=''approved'' where id=%L',other_id));
 update leave_requests set status='approved' where id=own_id;
 update leave_requests set status='rejected' where id=own_id; get diagnostics n=row_count;
 if n<>0 then raise exception 'Decision overwritten'; end if;
 reset role;
 insert into attendance_records(organization_id,user_id,user_type,work_date,status) values(org,person,'admin','2026-09-14','present');
 if (select count(*) from attendance_records where user_id=person and work_date='2026-09-14')<>2 then raise exception 'Attendance identity collision'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',person,'role','developer','app_metadata',jsonb_build_object('user_type','developer'))::text,true);
 set local role authenticated;
 if (select count(*) from leave_requests)<>1 or (select count(*) from attendance_records)<>1 then raise exception 'Typed own read leaked'; end if;
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('org',org,'user',person,'role','developer','app_metadata',jsonb_build_object('user_type','developer'),'overrides',jsonb_build_object('leave.view_own',false,'leave.request_own',false))::text,true);
 set local role authenticated;
 if (select count(*) from leave_requests)<>0 then raise exception 'Read override ignored'; end if;
 perform leave_expect_denied(format('insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(%L,%L,''developer'',%L,''2026-09-16'',''2026-09-16'',1)',org,person,lt));
 reset role;
end $$;
