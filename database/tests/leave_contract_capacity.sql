\set ON_ERROR_STOP on
\ir fractional_single_day_capacity.sql
update leave_requests set days=.5 where start_date='2026-11-03' and user_type='developer';
\ir ../../supabase/migrations/20260911182229_production_existing_leave_day_contract.sql
do $$ declare d record; begin
 select * into strict d from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-11-02') where user_type='developer';
 if d.leave_days<>0.5 or d.available_hours<>36 then raise exception 'Existing half-day capacity contract changed'; end if;
 if not exists(select 1 from capacity_week_v where week_start='2026-11-02' and user_type='developer' and leave_days=.5) then raise exception 'Capacity view ignored fraction'; end if;
 begin
 insert into leave_requests(organization_id,user_id,user_type,start_date,end_date,status,days) values('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','developer','2028-01-01','2028-01-03','pending',.5);
 raise exception 'Forged multi-date amount accepted';
 exception when invalid_parameter_value then null; end;
end $$;
