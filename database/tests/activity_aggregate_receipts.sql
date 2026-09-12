\ir tracking_work_context.sql
create schema if not exists app_private;
create table if not exists app_private.quota_locks(organization_id uuid primary key references organizations(id),revision bigint not null);
create or replace function app_private.lock_quota(p_org uuid) returns void language sql volatile security definer set search_path=pg_catalog,public,app_private as $$
 insert into app_private.quota_locks(organization_id,revision) values(p_org,1) on conflict(organization_id) do update set revision=quota_locks.revision+1;
$$;
update tracker_devices set revoked_at=null;
create table app_usage(id bigserial primary key,organization_id uuid,user_email varchar(255) not null,user_login text,session_id varchar(100) not null,app_name varchar(255) not null,
 app_name_raw text,window_title text,start_time timestamptz,end_time timestamptz,duration_seconds numeric,duration_minutes numeric,created_at timestamptz default now());
create table browser_usage(id bigserial primary key,organization_id uuid,user_email text,user_login text,session_id text not null,site text not null,
 first_seen timestamptz,last_seen timestamptz,duration_seconds numeric,duration_minutes numeric,created_at timestamptz default now());
alter table app_usage enable row level security;
alter table browser_usage enable row level security;
grant select,insert,update on app_usage,browser_usage to authenticated;
grant usage on sequence app_usage_id_seq,browser_usage_id_seq to authenticated;
-- Focused policies use the real device/typed-row helper; comprehensive plan/
-- retention policy behavior remains covered by the existing regression suite.
create policy own_device on app_usage for all to authenticated using(auth_tracker_row(to_jsonb(app_usage))) with check(auth_tracker_row(to_jsonb(app_usage)));
create policy own_device on browser_usage for all to authenticated using(auth_tracker_row(to_jsonb(browser_usage))) with check(auth_tracker_row(to_jsonb(browser_usage)));
\ir ../../supabase/migrations/20260912084740_production_activity_aggregate_receipts.sql
create function activity_test_payload(kind text,seconds numeric default 60) returns jsonb language sql as $$
 select jsonb_build_object('organization_id',auth_org(),'user_email','dev@example.test','session_id','70000000-0000-0000-0000-000000000001','duration_seconds',seconds,'duration_minutes',round(seconds/60,4)) ||
 case when kind='app' then '{"app_name":"Code","app_name_raw":"code","start_time":"2026-09-12T12:00:00Z","end_time":"2026-09-12T12:01:00Z"}'::jsonb
 else '{"site":"example.com","first_seen":"2026-09-12T12:00:00Z","last_seen":"2026-09-12T12:01:00Z"}'::jsonb end $$;
set role authenticated;
select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app''),1)','ACTIVITY_SESSION_REQUIRED');
insert into productivity_sessions(session_id,organization_id,user_id,user_email) values('70000000-0000-0000-0000-000000000001',auth_org(),auth_app_user_id(),'dev@example.test');
select ingest_activity_aggregate('app',activity_test_payload('app'),1);
select ingest_activity_aggregate('app',activity_test_payload('app'),1);
select ingest_activity_aggregate('browser',activity_test_payload('browser'),1);
select ingest_activity_aggregate('browser',activity_test_payload('browser'),1);
select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app'',61),1)','ACTIVITY_REVISION_CONFLICT');
select ingest_activity_aggregate('app',activity_test_payload('app',120),2);
select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app''),1)','ACTIVITY_REVISION_STALE');
select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app'',119),3)','ACTIVITY_DURATION_REGRESSION');
select expect_rejected('select ingest_activity_aggregate(''browser'',activity_test_payload(''browser'') || ''{"extra":true}'',2)','ACTIVITY_RECORD_INVALID');
select expect_rejected('select ingest_activity_aggregate(''browser'',activity_test_payload(''browser'') || ''{"user_email":"other@example.test"}'',2)','ACTIVITY_IDENTITY_MISMATCH');
select expect_rejected('select ingest_activity_aggregate(''browser'',activity_test_payload(''browser'') || ''{"organization_id":"00000000-0000-0000-0000-000000000001"}'',2)','ACTIVITY_IDENTITY_MISMATCH');
select expect_rejected('select ingest_activity_aggregate(''browser'',activity_test_payload(''browser'') || ''{"duration_minutes":9}'',2)','ACTIVITY_DURATION_INVALID');
select expect_rejected('select ingest_activity_aggregate(''browser'',activity_test_payload(''browser'') || ''{"first_seen":"infinity"}'',2)','ACTIVITY_TIMESTAMP_INVALID');
select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app'',120) || ''{"window_title":{}}'',3)','ACTIVITY_RECORD_INVALID');
select expect_rejected('update app_usage set duration_seconds=999','ACTIVITY_RECEIPT_MISMATCH');
select expect_rejected('update app_usage set ingest_revision=null,ingest_payload=null','ACTIVITY_RECEIPT_REQUIRED');
insert into app_usage(organization_id,user_email,session_id,app_name,app_name_raw) values(auth_org(),'dev@example.test','legacy','Legacy','legacy');
do $$ begin
 if (select count(*) from app_usage where app_name_raw='code')<>1 or (select count(*) from browser_usage)<>1 then raise exception 'Duplicate receipts'; end if;
end $$;
select revoke_tracker_device((select id from tracker_devices limit 1));
select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app'',120),2)','ACTIVITY_DEVICE_REQUIRED');
reset role;
do $$ begin if has_function_privilege('anon','ingest_activity_aggregate(text,jsonb,bigint)','EXECUTE') then raise exception 'Unsafe anonymous grant'; end if; end $$;
update tracker_devices set revoked_at=null;
-- A higher revision must execute UPDATE, never hit an INSERT quota hook.
begin;
create function reject_activity_insert() returns trigger language plpgsql as $$ begin raise exception 'TEST_INSERT_QUOTA'; end $$;
create trigger test_insert_quota before insert on app_usage for each row execute function reject_activity_insert();
set local role authenticated;
select ingest_activity_aggregate('app',activity_test_payload('app',180),3);
select ingest_activity_aggregate('app',activity_test_payload('app',180),3);
reset role;
rollback;
-- Model an existing restrictive retention/session visibility predicate. The
-- invoker RPC must honor it for every new aggregate update.
begin;
create policy test_hidden_session on productivity_sessions as restrictive for select to authenticated using(false);
set local role authenticated;
select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app'',180),3)','ACTIVITY_SESSION_REQUIRED');
reset role;
rollback;
