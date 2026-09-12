\ir tracking_work_context.sql
alter table productivity_sessions add column status text default 'periodic',add column total_duration numeric default 0;
\ir ../../supabase/migrations/20260912081724_production_tracking_break_history.sql
update tracker_devices set revoked_at=null;
create function public.test_break_write(periods jsonb, seconds numeric default 0) returns void language sql as $$
 insert into productivity_sessions(session_id,organization_id,user_id,user_email,break_periods,break_duration)
 values('70000000-0000-0000-0000-000000000001',auth_org(),auth_app_user_id(),'dev@example.test',periods,seconds)
 on conflict(session_id) do update set break_periods=excluded.break_periods,break_duration=excluded.break_duration $$;
set role authenticated;
select test_break_write('[]');
select test_break_write('[{"id":"80000000-0000-0000-0000-000000000001","started_at":"2026-09-12T12:00:00Z","ended_at":null,"duration_seconds":0}]');
select expect_rejected('select test_break_write(''[]'')','TRACKING_BREAK_HISTORY_IMMUTABLE');
select expect_rejected('update productivity_sessions set status=''completed'' where session_id=''70000000-0000-0000-0000-000000000001''','TRACKING_BREAK_OPEN_INVALID');
-- Clock moved backwards; monotonic seconds remain valid.
select test_break_write('[{"id":"80000000-0000-0000-0000-000000000001","started_at":"2026-09-12T12:00:00Z","ended_at":"2026-09-12T11:59:00Z","duration_seconds":30.25}]',30.25);
select test_break_write('[{"id":"80000000-0000-0000-0000-000000000001","started_at":"2026-09-12T12:00:00Z","ended_at":"2026-09-12T11:59:00Z","duration_seconds":30.25}]',30.25);
select expect_rejected('update productivity_sessions set break_duration=100 where session_id=''70000000-0000-0000-0000-000000000001''','TRACKING_BREAK_TOTAL_MISMATCH');
select expect_rejected('update productivity_sessions set break_periods=jsonb_set(break_periods,''{0,ended_at}'',''null'') where session_id=''70000000-0000-0000-0000-000000000001''','TRACKING_BREAK_OPEN_INVALID');
select expect_rejected('update productivity_sessions set break_periods=jsonb_set(break_periods,''{0,duration_seconds}'',''31''),break_duration=31 where session_id=''70000000-0000-0000-0000-000000000001''','TRACKING_BREAK_HISTORY_IMMUTABLE');
update productivity_sessions set status='completed',total_duration=60 where session_id='70000000-0000-0000-0000-000000000001';
do $$ declare item jsonb; malformed jsonb; begin
 foreach item in array array[
  '{}'::jsonb,
  '{"id":"not-uuid","started_at":"2026-09-12T12:00:00Z","ended_at":null,"duration_seconds":0}'::jsonb,
  '{"id":"80000000-0000-0000-0000-000000000001","started_at":"infinity","ended_at":null,"duration_seconds":0}'::jsonb,
  '{"id":"80000000-0000-0000-0000-000000000001","started_at":"2026-09-12T12:00:00Z","ended_at":null,"duration_seconds":-1}'::jsonb,
  '{"id":"80000000-0000-0000-0000-000000000001","started_at":"2026-09-12T12:00:00Z","ended_at":null,"duration_seconds":0,"extra":true}'::jsonb
 ] loop
  perform expect_rejected(format('select test_break_write(%L::jsonb)',jsonb_build_array(item)),'TRACKING_BREAK_INVALID');
 end loop;
 if (select total_duration from productivity_sessions where session_id='70000000-0000-0000-0000-000000000001')<>60 then raise exception 'Breaks modified tracked time'; end if;
end $$;
select expect_rejected('insert into productivity_sessions(session_id,organization_id,user_id,user_email) values(gen_random_uuid(),''00000000-0000-0000-0000-000000000001'',auth_app_user_id(),''dev@example.test'')','new row violates row-level security');
select expect_rejected('insert into productivity_sessions(session_id,organization_id,user_id,user_email) values(gen_random_uuid(),auth_org(),''00000000-0000-0000-0000-000000000099'',''dev@example.test'')','new row violates row-level security');
select expect_rejected('update productivity_sessions set break_periods=break_periods || ''[{"id":"80000000-0000-0000-0000-000000000002","started_at":"2026-09-12T13:00:00Z","ended_at":"2026-09-12T13:01:00Z","duration_seconds":60}]''::jsonb,break_duration=90.25 where session_id=''70000000-0000-0000-0000-000000000001''','TRACKING_BREAK_SESSION_COMPLETED');
update productivity_sessions set break_periods=break_periods where session_id='70000000-0000-0000-0000-000000000001';
-- UPSERT also preserves completed history and status.
insert into productivity_sessions select * from productivity_sessions where session_id='70000000-0000-0000-0000-000000000001'
 on conflict(session_id) do update set break_periods=excluded.break_periods,break_duration=excluded.break_duration,status=excluded.status;
select expect_rejected('update productivity_sessions set status=''periodic'' where session_id=''70000000-0000-0000-0000-000000000001''','TRACKING_BREAK_SESSION_COMPLETED');
do $$ declare entry jsonb:='{"id":"80000000-0000-0000-0000-000000000002","started_at":"2026-09-12T12:00:00Z","ended_at":"2026-09-12T12:00:01Z","duration_seconds":1}'; begin
 perform expect_rejected(format('select test_break_write(%L::jsonb,2)',jsonb_build_array(entry,entry)),'TRACKING_BREAK_INVALID');
 entry:=jsonb_set(jsonb_set(entry,'{ended_at}','null'),'{duration_seconds}','0');
 perform expect_rejected(format('select test_break_write(%L::jsonb)',jsonb_build_array(entry,entry)),'TRACKING_BREAK_OPEN_INVALID');
end $$;
select revoke_tracker_device((select id from tracker_devices limit 1));
select expect_rejected('insert into productivity_sessions(session_id,organization_id,user_id,user_email) values(gen_random_uuid(),auth_org(),auth_app_user_id(),''dev@example.test'')','new row violates row-level security');
reset role;
do $$ begin if has_function_privilege('anon','guard_tracking_break_history()','EXECUTE') then raise exception 'Anon privilege'; end if; end $$;
