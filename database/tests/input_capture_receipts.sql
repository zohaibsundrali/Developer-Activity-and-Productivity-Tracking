\ir activity_aggregate_receipts.sql
create table keyboard_stats(id bigserial primary key,session_id text not null,developer_id text,user_email text,organization_id uuid,activity_score numeric,keyboard_activity_percentage numeric,
 active_time_minutes numeric,idle_time_minutes numeric,total_time_minutes numeric,total_keys integer,unique_keys integer,words_per_minute numeric,per_minute_summary jsonb,tracked_at timestamptz);
create table mouse_activities(id uuid primary key default gen_random_uuid(),session_id text not null,developer_id uuid not null,developer_name text,organization_id uuid,timestamp timestamptz,
 activity_status text,active_percentage double precision,idle_percentage double precision,created_at timestamp default now());
alter table keyboard_stats enable row level security;
alter table mouse_activities enable row level security;
grant select,insert,update on keyboard_stats,mouse_activities to authenticated;
grant usage on sequence keyboard_stats_id_seq to authenticated;
-- Focused RLS uses actual enrolled-device/typed-row authorization helpers.
create policy own_input on keyboard_stats for all to authenticated using(auth_tracker_row(to_jsonb(keyboard_stats))) with check(auth_tracker_row(to_jsonb(keyboard_stats)));
create policy own_input on mouse_activities for all to authenticated using(auth_tracker_row(to_jsonb(mouse_activities))) with check(auth_tracker_row(to_jsonb(mouse_activities)));
\ir ../../supabase/migrations/20260912093359_production_input_capture_receipts.sql
create function input_test_payload(kind text) returns jsonb language sql as $$ select case when kind='keyboard' then '{"active_time_minutes": 0.02, "activity_score": 76.0, "developer_id": "00000000-0000-0000-0000-000000000012", "idle_time_minutes": 0.0, "keyboard_activity_percentage": 100.0, "organization_id": "00000000-0000-0000-0000-000000000002", "per_minute_summary": [{"Active %": 0.0, "Active Seconds": 0.0, "Avg Key Duration": 0.0, "Backspaces": 0, "Idle Seconds": 0.0, "Key Combos": 0, "Key Presses": 1, "Minute": "2026-09-12 11:29", "Special Keys": 0, "Unique Keys": 1, "WPM": 20.0}], "session_id": "70000000-0000-0000-0000-000000000001", "total_keys": 1, "total_time_minutes": 0.02, "tracked_at": "2026-09-12T09:29:54.801244+00:00", "unique_keys": 1, "user_email": "dev@example.test", "words_per_minute": 12.0}'::jsonb else '{"organization_id":"00000000-0000-0000-0000-000000000002","developer_id":"00000000-0000-0000-0000-000000000012","session_id":"70000000-0000-0000-0000-000000000001","developer_name":"Test","timestamp":"2026-09-12T09:00:00Z","activity_status":"active","active_percentage":60,"idle_percentage":40}'::jsonb end $$;
set role authenticated;
select ingest_input_capture('keyboard','90000000-0000-0000-0000-000000000001',input_test_payload('keyboard'));
select ingest_input_capture('keyboard','90000000-0000-0000-0000-000000000001',input_test_payload('keyboard'));
select ingest_input_capture('mouse','90000000-0000-0000-0000-000000000002',input_test_payload('mouse'));
select ingest_input_capture('mouse','90000000-0000-0000-0000-000000000002',input_test_payload('mouse'));
select expect_rejected('select ingest_input_capture(''mouse'',''90000000-0000-0000-0000-000000000002'',input_test_payload(''mouse'')||''{"active_percentage":55}'')','INPUT_CAPTURE_CONFLICT');
select expect_rejected('select ingest_input_capture(''mouse'',gen_random_uuid(),input_test_payload(''mouse'')||''{"active_percentage":101}'')','INPUT_METRICS_INVALID');
select expect_rejected('select ingest_input_capture(''keyboard'',gen_random_uuid(),input_test_payload(''keyboard'')||''{"raw_keys":"secret"}'')','INPUT_PAYLOAD_INVALID');
select expect_rejected('select ingest_input_capture(''keyboard'',gen_random_uuid(),input_test_payload(''keyboard'')||''{"per_minute_summary":[{"Minute":"x","keys":"secret"}]}'')','INPUT_SUMMARY_INVALID');
select expect_rejected('select ingest_input_capture(''keyboard'',gen_random_uuid(),input_test_payload(''keyboard'')||''{"total_keys":-1}'')','INPUT_METRICS_INVALID');
select expect_rejected('select ingest_input_capture(''mouse'',gen_random_uuid(),input_test_payload(''mouse'')||''{"developer_id":"00000000-0000-0000-0000-000000000099"}'')','INPUT_IDENTITY_MISMATCH');
select expect_rejected('select ingest_input_capture(''mouse'',gen_random_uuid(),input_test_payload(''mouse'')||''{"organization_id":"00000000-0000-0000-0000-000000000001"}'')','INPUT_IDENTITY_MISMATCH');
select expect_rejected('select ingest_input_capture(''mouse'',gen_random_uuid(),input_test_payload(''mouse'')||''{"session_id":"missing"}'')','INPUT_SESSION_REQUIRED');
select expect_rejected('update keyboard_stats set total_keys=99','INPUT_CAPTURE_IMMUTABLE');
select expect_rejected('update mouse_activities set capture_id=null,capture_payload=null','INPUT_CAPTURE_IMMUTABLE');
do $$ begin if (select count(*) from keyboard_stats)<>1 or (select count(*) from mouse_activities)<>1 then raise exception 'Duplicate capture'; end if; end $$;
select revoke_tracker_device((select id from tracker_devices limit 1));
select expect_rejected('select ingest_input_capture(''keyboard'',''90000000-0000-0000-0000-000000000001'',input_test_payload(''keyboard''))','INPUT_DEVICE_REQUIRED');
reset role;
update tracker_devices set revoked_at=null;
begin;
create policy hidden_input_session on productivity_sessions as restrictive for select to authenticated using(false);
set local role authenticated;
select expect_rejected('select ingest_input_capture(''keyboard'',gen_random_uuid(),input_test_payload(''keyboard''))','INPUT_SESSION_REQUIRED');
reset role;
rollback;
do $$ begin if has_function_privilege('anon','ingest_input_capture(text,uuid,jsonb)','EXECUTE') then raise exception 'Anonymous RPC grant'; end if; end $$;
