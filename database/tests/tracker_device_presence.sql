\set ON_ERROR_STOP on
\ir typed_monitoring_read_permissions.sql
reset role;
create table organizations(id uuid primary key);
insert into organizations values('76000000-0000-0000-0000-000000000001'),('76000000-0000-0000-0000-000000000002');
alter table developers add primary key(id),add column organization_id uuid;
insert into developers(id,email,organization_id) select user_id,email,organization_id from memberships where user_type='developer';
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create table auth.sessions(id uuid primary key,user_id uuid);
\ir ../../supabase/migrations/20260911062805_production_device_sessions.sql
\ir ../../supabase/migrations/20260912154948_production_tracker_device_presence.sql
create function presence_claims(sid text default '81000000-0000-0000-0000-000000000001') returns text language sql as $$ select jsonb_build_object('org','76000000-0000-0000-0000-000000000001','user','76000000-0000-0000-0000-000000000011','sub','82000000-0000-0000-0000-000000000001','session_id',sid,'type','developer','app_metadata',jsonb_build_object('user_type','developer'))::text $$;
create function presence_expect(query text,expected text) returns void language plpgsql as $$ begin
 begin execute query; exception when others then if position(expected in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected %',expected; end $$;
grant execute on function presence_claims(text),presence_expect(text,text) to authenticated;
insert into auth.sessions values('81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001'),('81000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims',presence_claims(),false);
set role authenticated;
select enroll_tracker_device('First','linux');
do $$ declare initial jsonb; ack jsonb; newer jsonb; begin
 if get_tracker_presence_epoch()->'epoch'<>'null'::jsonb then raise exception 'Expected empty epoch'; end if;
 initial:=start_tracker_presence_stream(null,'83000000-0000-0000-0000-000000000001','tracking');
 if initial->>'state'<>'tracking' or (initial->>'sequence')::int<>0 then raise exception 'Invalid initialization'; end if;
 ack:=heartbeat_tracker_presence((initial->>'epoch')::uuid,3,'paused');
 if start_tracker_presence_stream(null,'83000000-0000-0000-0000-000000000001','idle')<>ack then raise exception 'Retry mutated receipt'; end if;
 perform presence_expect(format('select heartbeat_tracker_presence(%L,2,''idle'')',initial->>'epoch'),'PRESENCE_SEQUENCE_STALE');
 perform presence_expect(format('select heartbeat_tracker_presence(%L,3,''paused'')',initial->>'epoch'),'PRESENCE_SEQUENCE_STALE');
 newer:=start_tracker_presence_stream((initial->>'epoch')::uuid,'83000000-0000-0000-0000-000000000002','idle');
 perform presence_expect(format('select heartbeat_tracker_presence(%L,4,''tracking'')',initial->>'epoch'),'PRESENCE_STREAM_STALE');
 perform presence_expect('select start_tracker_presence_stream(null,''83000000-0000-0000-0000-000000000001'',''tracking'')','PRESENCE_STREAM_STALE');
 if heartbeat_tracker_presence((newer->>'epoch')::uuid,1,'tracking')->>'state'<>'tracking' then raise exception 'New heartbeat failed'; end if;
end $$;
select presence_expect('update tracker_device_presence set state=''idle''','permission denied');
select presence_expect('select * from tracker_device_presence','permission denied');
select presence_expect('select monitoring_tracker_presence(auth_org(),auth_app_user_id())','PRESENCE_FORBIDDEN');
reset role;
insert into user_permissions(user_id,user_type,permission_key,allowed,membership_id) select user_id,user_type,'monitoring.view',true,id from memberships where user_type='developer' and user_id='76000000-0000-0000-0000-000000000011';
select set_config('request.jwt.claims',presence_claims('81000000-0000-0000-0000-000000000002'),false);
set role authenticated;
select enroll_tracker_device('Second','windows');
do $$ declare data jsonb; begin
 data:=monitoring_tracker_presence(auth_org(),auth_app_user_id());
 if (data->>'total')::int<>2 or data->>'freshness_seconds'<>'90' or jsonb_array_length(data->'devices')<>2 then raise exception 'Wrong multi-device result'; end if;
 if data->'devices'->0 ? 'session_id' or data->'devices'->0 ? 'epoch' or data->'devices'->0 ? 'auth_user_id' then raise exception 'Private metadata leaked'; end if;
 if data->'devices'->1->'state'<>'null'::jsonb or data->'devices'->1->'last_seen_at'<>'null'::jsonb then raise exception 'Unseen device falsely online'; end if;
end $$;
select presence_expect('select monitoring_tracker_presence(''76000000-0000-0000-0000-000000000002'',auth_app_user_id())','PRESENCE_FORBIDDEN');
reset role;
-- Server receipt age is reported honestly; reads never refresh a heartbeat.
update tracker_device_presence set received_at=now()-interval '100 seconds';
set role authenticated;
do $$ declare data jsonb; begin data:=monitoring_tracker_presence(auth_org(),auth_app_user_id());
 if (data->>'server_now')::timestamptz-(data->'devices'->0->>'last_seen_at')::timestamptz<interval '90 seconds' then raise exception 'Stale presence appeared fresh'; end if; end $$;
reset role;
-- Missing server Auth session prevents writes and prevents online display.
delete from auth.sessions where id='81000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims',presence_claims(),false);
set role authenticated;
select presence_expect('select get_tracker_presence_epoch()','PRESENCE_DEVICE_REQUIRED');
do $$ declare data jsonb; entry jsonb; begin data:=monitoring_tracker_presence(auth_org(),auth_app_user_id());
 for entry in select value from jsonb_array_elements(data->'devices') loop if entry->'last_seen_at'<>'null'::jsonb or entry->'state'<>'null'::jsonb then raise exception 'Deleted Auth session online'; end if; end loop; end $$;
reset role;
select set_config('request.jwt.claims',presence_claims('81000000-0000-0000-0000-000000000002'),false);
update tracker_devices set expires_at=now()-interval '1 second' where session_id='81000000-0000-0000-0000-000000000002';
set role authenticated;
select presence_expect('select get_tracker_presence_epoch()','PRESENCE_DEVICE_REQUIRED');
reset role;
update tracker_devices set expires_at=now()+interval '1 day',revoked_at=now() where session_id='81000000-0000-0000-0000-000000000002';
set role authenticated;
select presence_expect('select get_tracker_presence_epoch()','PRESENCE_DEVICE_REQUIRED');
reset role;
do $$ begin if has_table_privilege('authenticated','tracker_device_presence','UPDATE') or has_function_privilege('anon','get_tracker_presence_epoch()','EXECUTE') or has_function_privilege('authenticated','app_private.lock_presence_device()','EXECUTE') then raise exception 'Unsafe direct access'; end if; end $$;
-- Bounded read list discloses truncation, without hiding total enrollment count.
insert into tracker_devices(organization_id,developer_id,auth_user_id,session_id,name,platform)
 select '76000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000011',
 '82000000-0000-0000-0000-000000000001',gen_random_uuid(),'Unseen-'||n,'linux' from generate_series(1,101) n;
set role authenticated;
do $$ declare data jsonb; begin data:=monitoring_tracker_presence(auth_org(),auth_app_user_id());
 if (data->>'total')::int<>103 or jsonb_array_length(data->'devices')<>100 or data->>'truncated'<>'true' then raise exception 'Unbounded or incomplete device count'; end if; end $$;
reset role;
-- A populated foreign JWT identity cannot write an enrolled session.
select set_config('request.jwt.claims',jsonb_set(presence_claims()::jsonb,'{sub}','"82000000-0000-0000-0000-000000000099"')::text,false);
set role authenticated;
select presence_expect('select get_tracker_presence_epoch()','PRESENCE_DEVICE_REQUIRED');
reset role;
-- Reset one valid session and prove suspension also blocks heartbeat authority.
insert into auth.sessions values('81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims',presence_claims(),false);
update memberships set status='inactive' where user_id='76000000-0000-0000-0000-000000000011' and user_type='developer';
set role authenticated;
select presence_expect('select get_tracker_presence_epoch()','PRESENCE_DEVICE_REQUIRED');
select presence_expect('select monitoring_tracker_presence(''76000000-0000-0000-0000-000000000001'',''76000000-0000-0000-0000-000000000011'')','PRESENCE_FORBIDDEN');
reset role;
