-- Isolated PostgreSQL fixture, using production 088 then its replacement.
\set ON_ERROR_STOP on
create table employee_profiles(organization_id uuid,user_id uuid,user_type text,created_at timestamptz default now(),unique(organization_id,user_id,user_type));
create table task_time_logs(organization_id uuid,developer_id uuid,started_at timestamptz,seconds integer);
create table leave_requests(organization_id uuid,user_id uuid,user_type text,start_date date,end_date date,status text);
create table project_members(organization_id uuid,project_id uuid,user_id uuid,user_type text,allocation_pct integer);
create table projects(id uuid primary key,status text,organization_id uuid);
create table developer_tasks(organization_id uuid,developer_id uuid,estimated_hours numeric,status text);
create function timesheet_week_of(timestamptz) returns date language sql immutable as $$ select date_trunc('week',$1 at time zone 'UTC')::date $$;
\ir ../088_capacity_planning.sql
\ir ../../supabase/migrations/20260911121040_production_typed_capacity_identity.sql
insert into employee_profiles(organization_id,user_id,user_type,weekly_hours) values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','admin',20),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','developer',40);
insert into task_time_logs values('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','2026-09-07 12:00Z',36000);
insert into leave_requests values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','admin','2026-09-07','2026-09-08','approved'),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','developer','2026-09-09','2026-09-09','approved');
insert into projects values('75000000-0000-0000-0000-000000000003','active','75000000-0000-0000-0000-000000000001'),('75000000-0000-0000-0000-000000000004','active','75000000-0000-0000-0000-000000000001');
insert into project_members values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000003','75000000-0000-0000-0000-000000000002','admin',30),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000004','75000000-0000-0000-0000-000000000002','developer',80);
insert into developer_tasks values('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002',15,'in_progress');
do $$ declare a record; d record; begin
 if (select count(*) from capacity_week_v)<>2 then raise exception 'Typed capacity merged or duplicated people'; end if;
 select * into strict a from capacity_week_v where user_type='admin';
 select * into strict d from capacity_week_v where user_type='developer';
 if a.weekly_hours<>20 or a.leave_days<>2 or a.available_hours<>12 or a.logged_hours<>0 or a.allocation_pct<>30 or a.open_estimated_hours is not null or a.project_count<>1 then raise exception 'Admin capacity mixed developer data: %',row_to_json(a); end if;
 if d.weekly_hours<>40 or d.leave_days<>1 or d.available_hours<>32 or d.logged_hours<>10 or d.allocation_pct<>80 or d.open_estimated_hours<>15 or d.project_count<>1 then raise exception 'Developer capacity mixed admin data: %',row_to_json(d); end if;
 update employee_profiles set weekly_hours=null where user_type='admin';
 if exists(select 1 from capacity_week_v where user_type='admin' and (weekly_hours is not null or available_hours is not null or utilisation_pct is not null)) then raise exception 'Unset hours borrowed other profile'; end if;
 if not exists(select 1 from pg_class where oid='capacity_week_v'::regclass and 'security_invoker=true'=any(reloptions)) then raise exception 'View lost invoker security'; end if;
end $$;
