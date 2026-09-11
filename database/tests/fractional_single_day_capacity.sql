\set ON_ERROR_STOP on
\ir selected_week_capacity.sql
alter table leave_requests add column days numeric(4,1);
update leave_requests set days=end_date-start_date+1;
\ir ../../supabase/migrations/20260911123509_production_fractional_single_day_capacity.sql
update employee_profiles set weekly_hours=20 where user_type='admin';
insert into leave_requests(organization_id,user_id,user_type,start_date,end_date,status,days) values
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','developer','2026-11-03','2026-11-03','approved',0.5),
 ('75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002','admin','2026-11-03','2026-11-03','approved',1);
do $$ declare d record; a record; begin
 select * into strict d from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-11-02') where user_type='developer';
 select * into strict a from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-11-02') where user_type='admin';
 if d.leave_days<>0.5 or d.available_hours<>36 then raise exception 'Half-day failed: %',row_to_json(d); end if;
 if a.leave_days<>1 or a.available_hours<>16 then raise exception 'Full-day or typed isolation failed'; end if;
 if not exists(select 1 from capacity_week_v where week_start='2026-11-02' and user_type='developer' and leave_days=0.5 and available_hours=36) then raise exception 'View ignored half-day'; end if;
 if exists(select 1 from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-11-09') where leave_days<>0 or available_hours<>weekly_hours) then raise exception 'Leave crossed unmatched week'; end if;
 -- Old direct writes could store >1 against one date; preserve historical span
 -- behavior rather than applying an invalid fraction or silently changing data.
 update leave_requests set days=2 where start_date='2026-11-03' and user_type='developer';
 if not exists(select 1 from capacity_for_week('75000000-0000-0000-0000-000000000001','2026-11-02') where user_type='developer' and leave_days=1 and available_hours=32) then raise exception 'Legacy invalid amount changed span semantics'; end if;
end $$;
