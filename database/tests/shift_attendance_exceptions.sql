\ir work_shift_scheduling.sql
\ir ../../supabase/migrations/20260914174305_production_shift_attendance_exceptions.sql
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select shift_test_save(90,0,'published',current_date-4);
reset role;
create function exception_test_report(sc text default 'me') returns jsonb language sql as $$select shift_attendance_report(current_date-5,current_date-3,sc,5,5);$$;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
do $$declare report jsonb;begin
 report:=exception_test_report();if jsonb_array_length(report->'rows')<>1 or report->'rows'->0->'snapshot'->'shift'->>'user_type'<>'developer' then raise exception 'Typed report mismatch';end if;
 perform timesheet_expect('select exception_test_report(''all'')','EXCEPTION_FORBIDDEN');
 perform timesheet_expect('select app_private.shift_attendance_snapshot(''b1000000-0000-0000-0000-000000000090'')','permission denied');
 perform timesheet_expect('delete from shift_attendance_reviews','permission denied');
end$$;
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
do $$declare row jsonb; review jsonb; fp text;begin
 row:=exception_test_report('all')->'rows'->0;fp:=row->>'fingerprint';
 review:=review_shift_attendance('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000090',fp,5,5,'excused','Approved explanation');
 if review is distinct from review_shift_attendance('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000090',fp,5,5,'excused','Approved explanation') then raise exception 'Retry changed review';end if;
 if (select count(*) from shift_attendance_reviews)<>1 then raise exception 'Duplicate review';end if;
 perform timesheet_expect(format('select review_shift_attendance(''c1000000-0000-0000-0000-000000000002'',''b1000000-0000-0000-0000-000000000090'',%L,10,5,''excused'',''Different grace'')',fp),'EXCEPTION_STALE');
 perform timesheet_expect(format('select review_shift_attendance(''c1000000-0000-0000-0000-000000000001'',''b1000000-0000-0000-0000-000000000090'',%L,5,5,''reopened'',''Changed retry'')',fp),'EXCEPTION_STALE');
end$$;
reset role;
-- Changing the underlying shift invalidates the review fingerprint.
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select shift_test_save(90,1,'published',current_date-4,'developer','UTC',10,18);
do $$declare row jsonb;old_fp text;begin
 row:=exception_test_report('all')->'rows'->0;old_fp:=row->'reviews'->0->>'fingerprint';
 if old_fp is null or row->>'fingerprint'=old_fp then raise exception 'Changed evidence retained fingerprint';end if;
 perform timesheet_expect(format('select review_shift_attendance(''c1000000-0000-0000-0000-000000000003'',''b1000000-0000-0000-0000-000000000090'',%L,5,5,''excused'',''Stale screen'')',old_fp),'EXCEPTION_STALE');
end$$;
reset role;
-- Own attendance readers can see their audit; other typed people cannot.
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
do $$begin if (select count(*) from shift_attendance_reviews)<>1 then raise exception 'Own review missing';end if;end$$;
reset role;
begin;
insert into user_permissions(membership_id,permission_key,allowed) select id,'attendance.view_own',false from memberships where user_id='99100000-0000-0000-0000-000000000011' and user_type='developer';
set local role authenticated;
select timesheet_expect('select exception_test_report()','EXCEPTION_FORBIDDEN');
do $$begin if exists(select 1 from shift_attendance_reviews) then raise exception 'Denied review exposed';end if;end$$;
reset role;
rollback;
-- Clock timestamps still match when a historical work_date was entered incorrectly.
begin;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
insert into attendance_records(organization_id,user_id,user_type,work_date,check_in_at,check_out_at,status,source)
values('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer',current_date-40,(current_date-4+time '10:05') at time zone 'UTC',(current_date-4+time '18:00') at time zone 'UTC','present','hr');
set local role authenticated;
do $$declare row jsonb;begin
 row:=exception_test_report('all')->'rows'->0;
 if not exists(select 1 from jsonb_array_elements(row->'snapshot'->'attendance') a where a->>'work_date'=(current_date-40)::text) then raise exception 'Real clock omitted due to work_date';end if;
 if row->'reviews'->0 ? 'evidence' then raise exception 'Full audit evidence leaked into bulk response';end if;
 if not exists(select 1 from shift_attendance_reviews where evidence->'shift'->>'id'='b1000000-0000-0000-0000-000000000090') then raise exception 'Review evidence not retained';end if;
end$$;
reset role;
rollback;
-- The same profile UUID in a different type is never included in an own report.
begin;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
set local role authenticated;
select shift_test_save(91,0,'published',current_date-4,'admin','UTC',19,20);
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),true);
set local role authenticated;
do $$begin if jsonb_array_length(exception_test_report()->'rows')<>1 then raise exception 'Typed profile collision leaked';end if;end$$;
reset role;
rollback;
-- A foreign tenant shift ID cannot be used to write a review.
begin;
insert into organizations(id,name) values('99700000-0000-0000-0000-000000000001','Exception foreign tenant');
insert into work_shifts(id,organization_id,user_id,user_type,assignee_name,title,start_at,end_at,timezone,status,note,version,created_by,created_by_type,updated_by,updated_by_type)
select 'c9000000-0000-0000-0000-000000000001','99700000-0000-0000-0000-000000000001',user_id,user_type,assignee_name,title,start_at,end_at,timezone,status,note,version,created_by,created_by_type,updated_by,updated_by_type from work_shifts where id='b1000000-0000-0000-0000-000000000090';
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
set local role authenticated;
select timesheet_expect('select review_shift_attendance(''c1000000-0000-0000-0000-000000000099'',''c9000000-0000-0000-0000-000000000001'',''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'',5,5,''excused'',''Wrong tenant'')','EXCEPTION_NOT_FOUND');
reset role;
rollback;
select 'shift attendance exception contracts passed' as result;
