\ir transactional_attendance.sql
alter table developers add column if not exists name text default 'Developer fixture';
alter table admin_users add column if not exists name text default 'Administrator fixture';
\ir ../../supabase/migrations/20260914074151_production_work_shift_scheduling.sql
create function shift_test_save(n int,v int default 0,st text default 'published',d date default '2026-10-12',kind text default 'developer',zone text default 'UTC',start_hour int default 9,end_hour int default 17,target uuid default '99100000-0000-0000-0000-000000000011') returns jsonb language sql security invoker as $$
 select save_work_shift(('b1000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,v,target,kind,
 (d+make_interval(hours=>start_hour)) at time zone 'UTC',(d+make_interval(hours=>end_hour)) at time zone 'UTC',zone,'Shift '||n,st,'');
$$;
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
do $$ declare first jsonb; replay jsonb; begin
 first:=shift_test_save(1,0,'draft'); replay:=shift_test_save(1,0,'draft');
 if first->>'unchanged'<>'false' or replay->>'unchanged'<>'true' or first->'shift' is distinct from replay->'shift' then raise exception 'Create retry duplicated'; end if;
 if (select count(*) from work_shift_events)<>1 then raise exception 'Create audit duplicated'; end if;
 first:=shift_test_save(1,1); replay:=shift_test_save(1,1);
 if replay->>'unchanged'<>'true' or first->'shift' is distinct from replay->'shift' or (select count(*) from work_shift_events)<>2 then raise exception 'Publish retry duplicated'; end if;
end $$;
select shift_test_save(2,0,'published','2026-10-12','developer','Asia/Karachi',17,25);
select shift_test_save(4,0,'published','2026-10-12','admin');
select shift_test_save(5,0,'draft','2026-10-14');
select timesheet_expect('select shift_test_save(3)','SHIFT_OVERLAP');
select timesheet_expect($q$select shift_test_save(3,0,'draft','2026-10-14')$q$,'SHIFT_OVERLAP');
select timesheet_expect($q$select shift_test_save(1,0,'draft')$q$,'SHIFT_STALE');
select timesheet_expect($q$select shift_test_save(3,0,'published','2026-10-15','developer','Not/AZone')$q$,'SHIFT_INPUT_INVALID');
select timesheet_expect($q$select shift_test_save(3,0,'published','2026-10-15','developer','UTC',9,8)$q$,'SHIFT_INPUT_INVALID');
select timesheet_expect($q$select shift_test_save(3,0,'published','2026-10-15','developer','UTC',9,59)$q$,'SHIFT_INPUT_INVALID');
select timesheet_expect($q$select shift_test_save(3,0,'published','2026-10-15','developer','UTC',9,17,'99100000-0000-0000-0000-000000000099')$q$,'SHIFT_TARGET_NOT_FOUND');
select timesheet_expect($q$update work_shifts set status='published'$q$,'permission denied');
select timesheet_expect('delete from work_shift_events','permission denied');
do $$ begin if jsonb_array_length(work_shift_staff())<>3 then raise exception 'Roster must keep typed profiles distinct'; end if; end $$;
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
do $$ begin
 if (select count(*) from work_shifts)<>2 then raise exception 'Employee saw draft or another typed profile'; end if;
 if (select count(*) from work_shift_events)<>0 then raise exception 'Employee read manager audit'; end if;
end $$;
select timesheet_expect('select work_shift_staff()','SHIFT_FORBIDDEN');
select timesheet_expect($q$select shift_test_save(3,0,'published','2026-10-15')$q$,'SHIFT_FORBIDDEN');
reset role;
begin;
insert into user_permissions(membership_id,permission_key,allowed) select id,'attendance.view_own',false from memberships where user_id='99100000-0000-0000-0000-000000000011' and user_type='developer';
set local role authenticated;
do $$ begin if (select count(*) from work_shifts)<>0 then raise exception 'Own-view denial ignored'; end if; end $$;
reset role;
rollback;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select shift_test_save(1,2,'cancelled');
select shift_test_save(3);
select timesheet_expect('select shift_test_save(1,3)','SHIFT_CANCELLED');
reset role;
begin;
select set_config('test.billing_locked','yes',true);
set local role authenticated;
select timesheet_expect($q$select shift_test_save(6,0,'draft','2026-10-15')$q$,'BILLING_LOCKED');
reset role;
rollback;
begin;
update memberships set status='suspended' where organization_id='99100000-0000-0000-0000-000000000001' and user_id='99100000-0000-0000-0000-000000000012';
set local role authenticated;
select timesheet_expect('select work_shift_staff()','SHIFT_FORBIDDEN');
do $$ begin if (select count(*) from work_shifts)<>0 then raise exception 'Stale suspended claims read shifts'; end if; end $$;
reset role;
rollback;
select 'shift scheduling SQL contracts passed' as result;
