\set ON_ERROR_STOP on
-- Reuse the existing real-SQL regression fixtures, including leave fractions,
-- idle staff, selected week scoping, allocations and developer backlog.
\ir fractional_single_day_capacity.sql
alter table task_time_logs add column user_type text;
-- Fixture rows were explicitly developer-authored; this is test setup only,
-- not a production migration/backfill assumption.
update task_time_logs set user_type='developer';
create temporary table old_capacity as select * from capacity_week_v;
create temporary table old_selected_capacity as select * from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-09-07');
\ir ../../supabase/migrations/20260912101315_production_typed_time_log_capacity.sql
do $$ begin
 if exists((select * from old_capacity except select * from capacity_week_v)
   union all (select * from capacity_week_v except select * from old_capacity)) then raise exception 'Existing developer view semantics changed'; end if;
 if exists((select * from old_selected_capacity except select * from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-09-07'))
   union all (select * from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-09-07') except select * from old_selected_capacity)) then raise exception 'Existing selected capacity semantics changed'; end if;
end $$;
insert into task_time_logs(organization_id,developer_id,started_at,seconds,user_type) values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','2026-09-07 12:00Z',7200,'admin'),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','2026-09-07 13:00Z',3600,'admin'),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','2026-09-07 14:00Z',360000,null),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000099','2026-12-07 14:00Z',360000,null),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000098','2026-12-07 14:00Z',3600,'admin'),
 ('75000000-0000-0000-0000-000000000009','75000000-0000-0000-0000-000000000002','2026-09-07 12:00Z',360000,'admin');
do $$ declare admin_row record; dev_row record; begin
 select * into strict admin_row from capacity_week_v where organization_id='75000000-0000-0000-0000-000000000001' and user_id='75000000-0000-0000-0000-000000000002' and week_start='2026-09-07' and user_type='admin';
 select * into strict dev_row from capacity_week_v where organization_id='75000000-0000-0000-0000-000000000001' and user_id=admin_row.user_id and week_start=admin_row.week_start and user_type='developer';
 if admin_row.logged_hours<>3 or dev_row.logged_hours<>10 then raise exception 'Typed colliding logs merged: admin %, developer %',admin_row.logged_hours,dev_row.logged_hours; end if;
 if admin_row.weekly_hours<>20 or dev_row.weekly_hours<>40 then raise exception 'Typed contracted hours changed'; end if;
 if not exists(select 1 from capacity_for_week(admin_row.organization_id,admin_row.week_start) where user_id=admin_row.user_id and user_type='admin' and logged_hours=3) then raise exception 'Selected week lost admin logs'; end if;
 if not exists(select 1 from capacity_for_week(admin_row.organization_id,admin_row.week_start) where user_id=admin_row.user_id and user_type='developer' and logged_hours=10) then raise exception 'Selected week mixed developer logs'; end if;
 if exists(select 1 from capacity_week_v where user_id='75000000-0000-0000-0000-000000000099') or exists(select 1 from capacity_for_week(admin_row.organization_id,'2026-12-07') where user_id='75000000-0000-0000-0000-000000000099') then raise exception 'Unresolved legacy type guessed'; end if;
 if not exists(select 1 from capacity_week_v where user_id='75000000-0000-0000-0000-000000000098' and user_type='admin' and logged_hours=1) then raise exception 'Log-only admin week missing'; end if;
 if exists(select 1 from capacity_for_week(admin_row.organization_id,admin_row.week_start) where organization_id<>admin_row.organization_id) then raise exception 'Other tenant included'; end if;
 if has_function_privilege('authenticated','capacity_for_week(uuid,date)','execute') or has_function_privilege('anon','capacity_for_week(uuid,date)','execute') then raise exception 'RPC became publicly executable'; end if;
 if not has_function_privilege('service_role','capacity_for_week(uuid,date)','execute') then raise exception 'Service RPC grant lost'; end if;
 if not coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='capacity_week_v'::regclass),false) then raise exception 'View invoker security lost'; end if;
end $$;
select 'Typed time-log capacity PASS' as result;
