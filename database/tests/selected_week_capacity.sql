\set ON_ERROR_STOP on
\ir typed_capacity_identity.sql
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
create table memberships(organization_id uuid,user_id uuid,user_type text,status text);
\ir ../../supabase/migrations/20260911122437_production_selected_week_capacity.sql
-- No membership rows yet: historical trace-only week is exactly the typed view.
do $$ begin
 if exists((select * from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-09-07') except select * from capacity_week_v)
 union all (select * from capacity_week_v except select * from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-09-07'))) then raise exception 'Historical capacity changed'; end if;
 begin perform capacity_for_week('75000000-0000-0000-0000-000000000001','2026-09-08'); raise exception 'Non-Monday accepted'; exception when invalid_parameter_value then null; end;
 if has_function_privilege('authenticated','capacity_for_week(uuid,date)','execute') or has_function_privilege('anon','capacity_for_week(uuid,date)','execute') then raise exception 'RPC publicly executable'; end if;
 if not has_function_privilege('service_role','capacity_for_week(uuid,date)','execute') then raise exception 'Service cannot use RPC'; end if;
end $$;
insert into memberships values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','admin','active'),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','developer','active'),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000005','developer','suspended'),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000006','client','active'),
 ('75000000-0000-0000-0000-000000000009','75000000-0000-0000-0000-000000000007','developer','active');
insert into leave_requests values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000005','developer','2026-10-05','2026-10-20','approved'),
 ('75000000-0000-0000-0000-000000000009','75000000-0000-0000-0000-000000000007','developer','2026-10-05','2026-10-20','approved');
do $$ declare d record; begin
 if (select count(*) from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-10-12'))<>3 then raise exception 'Future idle/overlap seed incorrect'; end if;
 select * into strict d from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-10-12') where user_id='75000000-0000-0000-0000-000000000002' and user_type='developer';
 if d.logged_hours<>0 or d.weekly_hours<>40 or d.available_hours<>40 or d.allocation_pct<>80 or d.open_estimated_hours<>15 then raise exception 'Idle future developer capacity incorrect'; end if;
 if not exists(select 1 from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-10-12') where user_id='75000000-0000-0000-0000-000000000005' and leave_days=7 and available_hours is null) then raise exception 'Later week of suspended staff leave missing'; end if;
 if (select count(*) from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-11-02'))<>2 then raise exception 'Inactive/no-trace or foreign/client identity leaked'; end if;
end $$;

-- A logged week without leave must not manufacture seven days of absence.
insert into task_time_logs values('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','2026-11-02 12:00Z',3600);
do $$ begin
 if not exists(select 1 from capacity_week_v where week_start='2026-11-02' and user_type='developer' and leave_days=0 and available_hours=40 and logged_hours=1) then raise exception 'Historical view invented leave'; end if;
 if not exists(select 1 from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-11-02') where user_type='developer' and leave_days=0 and available_hours=40 and logged_hours=1) then raise exception 'Selected RPC invented leave'; end if;
end $$;
