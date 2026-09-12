\ir transactional_timesheet_review.sql
\ir ../075_attendance_and_leave.sql
\ir ../../supabase/migrations/20260911180705_production_typed_leave_authority.sql
\ir ../../supabase/migrations/20260911182229_production_existing_leave_day_contract.sql
grant select,insert,update,delete on attendance_records,leave_requests,leave_types to authenticated,service_role;
\ir ../../supabase/migrations/20260912113733_production_transactional_attendance.sql
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
do $$ declare first jsonb; next jsonb; begin
 first:=record_attendance('check_in','2026-10-05');
 next:=record_attendance('check_in','2026-10-05');
 if first->>'unchanged'<>'false' or next->>'unchanged'<>'true' or first->'record' is distinct from next->'record' then raise exception 'Checkin not idempotent'; end if;
 first:=record_attendance('check_out','2026-10-05');
 next:=record_attendance('check_out','2026-10-05');
 if first->>'unchanged'<>'false' or next->>'unchanged'<>'true' or first->'record' is distinct from next->'record' then raise exception 'Checkout not idempotent'; end if;
end $$;
select timesheet_expect('select record_attendance(''unknown'',''2026-10-05'')','ATTENDANCE_INPUT_INVALID');
select timesheet_expect('select record_attendance(''check_out'',''2026-10-06'')','ATTENDANCE_NO_CHECK_IN');
select timesheet_expect('select record_attendance(''check_in'',''2026-10-06'',null,null,''holiday'')','ATTENDANCE_INPUT_INVALID');
select timesheet_expect('insert into attendance_records(organization_id,user_id,user_type,work_date,status,source,check_in_at) values(auth_org(),auth_app_user_id(),''developer'',''2026-10-06'',''on_leave'',''system'',''2000-01-01Z'')','new row violates row-level security');
-- UPDATE denied by RLS either reports error or changes zero rows; verify stored clock.
do $$ declare n integer; begin update attendance_records set check_in_at='2000-01-01Z' where work_date='2026-10-05'; get diagnostics n=row_count; if n<>0 then raise exception 'Self forged stored clock'; end if; end $$;
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select record_attendance('check_in','2026-10-06','99100000-0000-0000-0000-000000000011','developer','absent');
select timesheet_expect('select record_attendance(''check_out'',''2026-10-06'',''99100000-0000-0000-0000-000000000011'',''developer'')','ATTENDANCE_NO_CHECK_IN');
select timesheet_expect('select record_attendance(''check_in'',''2026-10-06'',''99100000-0000-0000-0000-000000000011'')','ATTENDANCE_TARGET_AMBIGUOUS');
select record_attendance('check_in','2026-10-06','99100000-0000-0000-0000-000000000011','admin','holiday');
update attendance_records set note='Managed correction' where work_date='2026-10-06' and user_type='developer';
select timesheet_expect('insert into attendance_records(organization_id,user_id,user_type,work_date,status,source) values(auth_org(),''99900000-0000-0000-0000-000000000099'',''developer'',''2026-10-06'',''on_leave'',''system'')','ATTENDANCE_TARGET_NOT_FOUND');
reset role;
-- Actual leave decision trigger remains able to create the protected system day.
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) values(auth_org(),auth_app_user_id(),'developer',(select id from leave_types limit 1),'2026-10-07','2026-10-07',1);
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
update leave_requests set status='approved' where start_date='2026-10-07';
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
do $$ declare record jsonb; begin record:=record_attendance('check_in','2026-10-07'); if record->>'unchanged'<>'true' or record->'record'->>'status'<>'on_leave' then raise exception 'Leave overwritten'; end if; end $$;
select timesheet_expect('select record_attendance(''check_out'',''2026-10-07'')','ATTENDANCE_NO_CHECK_IN');
select set_config('test.billing_locked','yes',false);
select timesheet_expect('select record_attendance(''check_in'',''2026-10-08'')','BILLING_LOCKED');
select set_config('test.billing_locked','no',false);
reset role;
insert into user_permissions(membership_id,permission_key,allowed) select id,'attendance.log_own',false from memberships where user_id='99100000-0000-0000-0000-000000000011' and user_type='developer';
set role authenticated;
select timesheet_expect('select record_attendance(''check_in'',''2026-10-08'')','ATTENDANCE_FORBIDDEN');
reset role;
delete from user_permissions where permission_key='attendance.log_own';
do $$ begin if has_function_privilege('anon','record_attendance(text,date,uuid,text,text,text)','EXECUTE') then raise exception 'Anonymous attendance RPC'; end if; end $$;
-- Adversarial target lifecycle and permission checks use actual typed Auth.
begin;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
update memberships set status='suspended' where organization_id='99100000-0000-0000-0000-000000000001' and user_id='99100000-0000-0000-0000-000000000011' and user_type='developer';
set local role authenticated;
select timesheet_expect('select record_attendance(''check_in'',''2026-11-01'',''99100000-0000-0000-0000-000000000011'',''developer'')','ATTENDANCE_TARGET_NOT_FOUND');
reset role;
-- Seed the flag through a valid privileged deletion-worker lease; the ledger is
-- removed only inside this rollback fixture to isolate target flag rejection.
insert into app_private.organization_deletions(organization_id,organization_name,actor_id,actor_type,auth_user_id,receipt_hash,status,lease,lease_until) values('99100000-0000-0000-0000-000000000001','Attendance lifecycle fixture','99100000-0000-0000-0000-000000000012','admin','99100000-0000-0000-0000-000000000093','attendance-fixture','processing','99600000-0000-0000-0000-000000000099',now()+interval '1 hour');
select set_config('app.deletion_lease','99600000-0000-0000-0000-000000000099',true);
update memberships set status='active',deletion_blocked=true where organization_id='99100000-0000-0000-0000-000000000001' and user_id='99100000-0000-0000-0000-000000000011' and user_type='developer';
delete from app_private.organization_deletions where receipt_hash='attendance-fixture';
set local role authenticated;
select timesheet_expect('select record_attendance(''check_in'',''2026-11-01'',''99100000-0000-0000-0000-000000000011'',''developer'')','ATTENDANCE_TARGET_NOT_FOUND');
reset role;
-- Seed the flag through a valid privileged deletion-worker lease; the ledger is
-- removed only inside this rollback fixture to isolate target flag rejection.
insert into app_private.organization_deletions(organization_id,organization_name,actor_id,actor_type,auth_user_id,receipt_hash,status,lease,lease_until) values('99100000-0000-0000-0000-000000000001','Attendance lifecycle fixture','99100000-0000-0000-0000-000000000012','admin','99100000-0000-0000-0000-000000000093','attendance-fixture','processing','99600000-0000-0000-0000-000000000099',now()+interval '1 hour');
select set_config('app.deletion_lease','99600000-0000-0000-0000-000000000099',true);
update memberships set deletion_blocked=false where organization_id='99100000-0000-0000-0000-000000000001' and user_id='99100000-0000-0000-0000-000000000011' and user_type='developer';
delete from app_private.organization_deletions where receipt_hash='attendance-fixture';
delete from developers where organization_id='99100000-0000-0000-0000-000000000001' and id='99100000-0000-0000-0000-000000000011';
set local role authenticated;
select timesheet_expect('select record_attendance(''check_in'',''2026-11-01'',''99100000-0000-0000-0000-000000000011'',''developer'')','ATTENDANCE_TARGET_NOT_FOUND');
reset role;
rollback;
begin;
insert into organizations(id,name) values('99600000-0000-0000-0000-000000000001','Other attendance tenant');
insert into developers values('99600000-0000-0000-0000-000000000011','99600000-0000-0000-0000-000000000001','99600000-0000-0000-0000-000000000091');
insert into memberships(organization_id,user_id,user_type,role,status) values('99600000-0000-0000-0000-000000000001','99600000-0000-0000-0000-000000000011','developer','developer','active');
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
set local role authenticated;
select timesheet_expect('select record_attendance(''check_in'',''2026-11-01'',''99600000-0000-0000-0000-000000000011'',''developer'')','ATTENDANCE_TARGET_NOT_FOUND');
select timesheet_expect('insert into attendance_records(organization_id,user_id,user_type,work_date,check_in_at,check_out_at,source) values(auth_org(),auth_app_user_id(),''admin'',''2026-11-01'',''2026-11-01T11:00Z'',''2026-11-01T10:00Z'',''hr'')','ATTENDANCE_INPUT_INVALID');
select timesheet_expect('insert into attendance_records(organization_id,user_id,user_type,work_date,check_in_at,source) values(auth_org(),auth_app_user_id(),''admin'',''2026-11-01'',''infinity'',''hr'')','ATTENDANCE_INPUT_INVALID');
reset role;
insert into user_permissions(membership_id,permission_key,allowed) select id,'attendance.manage',false from memberships where user_id='99100000-0000-0000-0000-000000000012';
set local role authenticated;
select timesheet_expect('select record_attendance(''check_in'',''2026-11-01'',''99100000-0000-0000-0000-000000000011'',''developer'')','ATTENDANCE_FORBIDDEN');
reset role;
insert into user_permissions(membership_id,permission_key,allowed) select id,'attendance.manage',true from memberships where user_id='99100000-0000-0000-0000-000000000011' and user_type='developer';
select set_config('request.jwt.claims',timesheet_test_claims('developer'),true);
set local role authenticated;
do $$ declare r jsonb; begin r:=record_attendance('check_in','2026-11-01','99100000-0000-0000-0000-000000000012','admin','holiday'); if r->'record'->>'status'<>'holiday' then raise exception 'Explicit manage grant ignored'; end if; end $$;
reset role;
rollback;
begin;
insert into clients(id,organization_id,auth_user_id) values('99600000-0000-0000-0000-000000000021','99100000-0000-0000-0000-000000000001','99600000-0000-0000-0000-000000000092');
insert into memberships(organization_id,user_id,user_type,role,status) values('99100000-0000-0000-0000-000000000001','99600000-0000-0000-0000-000000000021','client','client','active');
insert into auth.users(id,raw_app_meta_data) values('99600000-0000-0000-0000-000000000092','{"organization_id":"99100000-0000-0000-0000-000000000001","app_user_id":"99600000-0000-0000-0000-000000000021","user_type":"client","role":"client"}');
select set_config('request.jwt.claims','{"sub":"99600000-0000-0000-0000-000000000092","app_metadata":{"organization_id":"99100000-0000-0000-0000-000000000001","app_user_id":"99600000-0000-0000-0000-000000000021","user_type":"client","role":"client"}}',true);
set local role authenticated;
select timesheet_expect('select record_attendance(''check_in'',''2026-11-01'')','ATTENDANCE_FORBIDDEN');
reset role;
rollback;
