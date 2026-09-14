\ir transactional_timesheet_review.sql
\ir ../../supabase/migrations/20260914082024_production_approved_time_export.sql
reset role;
select set_config('request.jwt.claims','{}',false);
-- Actual review RPC produces authoritative approval metadata.
select set_config('request.jwt.claims',timesheet_test_claims('admin'),false);
set role authenticated;
select decide_timesheet((select id from timesheets where user_type='developer' and week_start='2026-09-14'),'approved',null);
do $$ declare value jsonb; begin
 value:=approved_time_export('2026-09-14','2026-09-21');
 if (value->>'count')::integer<>1 or value->'rows'->0->>'approved_seconds'<>'1003' or value->'rows'->0->>'user_type'<>'developer' then raise exception 'Approved snapshot mismatch: %',value; end if;
end $$;
select timesheet_expect('select approved_time_export(''2026-09-15'',''2026-09-21'')','TIME_EXPORT_RANGE');
select timesheet_expect('select approved_time_export(''2026-09-14'',''2026-12-14'')','TIME_EXPORT_RANGE');
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
select timesheet_expect('select approved_time_export(''2026-09-14'',''2026-09-21'')','TIME_EXPORT_FORBIDDEN');
reset role;
begin;
insert into user_permissions(membership_id,permission_key,allowed) select id,'timesheet.view_all',false from memberships where user_type='admin' and user_id='99100000-0000-0000-0000-000000000011';
select set_config('request.jwt.claims',timesheet_test_claims('admin'),true);
set local role authenticated;
select timesheet_expect('select approved_time_export(''2026-09-14'',''2026-09-21'')','TIME_EXPORT_FORBIDDEN');
reset role;
rollback;
begin;
update memberships set role='finance' where user_id='99100000-0000-0000-0000-000000000012';
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"finance"') where id='99100000-0000-0000-0000-000000000093';
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
set local role authenticated;
do $$begin if (approved_time_export('2026-09-14','2026-09-21')->>'count')::integer<>1 then raise exception 'Finance export failed'; end if; end$$;
reset role;
rollback;
-- Aggregation remains complete above PostgREST's common 1,000-row cap.
begin;
select set_config('request.jwt.claims','{}',true);
insert into timesheets(organization_id,user_id,user_type,week_start,status,total_seconds,billable_seconds,decided_at,decided_by,decided_by_type)
 select '99100000-0000-0000-0000-000000000001',md5(n::text)::uuid,'developer','2026-10-05','approved',60,0,now(),'99100000-0000-0000-0000-000000000011','admin' from generate_series(1,1001) n;
select set_config('request.jwt.claims',timesheet_test_claims('admin'),true);
set local role authenticated;
do $$begin if (approved_time_export('2026-10-05','2026-10-05')->>'count')::integer<>1001 then raise exception 'Export was capped'; end if; end$$;
reset role;
-- Missing approval identity must fail the whole export.
update timesheets set decided_by_type=null where week_start='2026-10-05';
set local role authenticated;
select timesheet_expect('select approved_time_export(''2026-10-05'',''2026-10-05'')','TIME_EXPORT_SOURCE_INVALID');
reset role;
rollback;
select set_config('request.jwt.claims',timesheet_test_claims('admin'),false);
set role authenticated;
select decide_timesheet((select id from timesheets where user_type='developer' and week_start='2026-09-14'),'reopen','Correction');
do $$begin if (approved_time_export('2026-09-14','2026-09-21')->>'count')::integer<>0 then raise exception 'Reopened week exported'; end if; end$$;
reset role;
select 'approved-time export SQL contracts passed' as result;
