\ir transactional_attendance.sql
alter table task_time_logs add column source text;
\ir ../../supabase/migrations/20260914085225_production_mobile_field_tracking.sql
create function mobile_test_payload(n integer default 1) returns jsonb language sql as $$
 select jsonb_build_object('id',md5(('session'||n)::text)::uuid,'recovered',false,'segments',jsonb_build_array(jsonb_build_object('id',md5(('segment'||n)::text)::uuid,'start',to_char(date_trunc('day',now()-interval '4 days')+interval '10 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'end',to_char(date_trunc('day',now()-interval '4 days')+interval '11 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
 'points',jsonb_build_array(jsonb_build_object('at',to_char(date_trunc('day',now()-interval '4 days')+interval '10 minutes 30 seconds','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'lat',31.5,'lon',74.3,'accuracy',15,'mock',false)));
$$;
select set_config('request.jwt.claims',timesheet_test_claims('admin'),false);
set role authenticated;
select decide_timesheet(id,'reopen','Mobile fixture: editable week') from timesheets where user_type='developer' and status<>'draft';
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
do $$declare result jsonb; payload jsonb:=mobile_test_payload();begin
 result:=upload_mobile_work(payload);if result->>'work_seconds'<>'60' or (result->>'unchanged')::boolean then raise exception 'Initial mobile upload invalid'; end if;
 result:=upload_mobile_work(payload);if not (result->>'unchanged')::boolean then raise exception 'Retry not recognized'; end if;
 if (select count(*) from task_time_logs where source='mobile_timer')<>1 then raise exception 'Duplicate mobile time'; end if;
 perform timesheet_expect(format('select upload_mobile_work(%L::jsonb)',jsonb_set(payload,'{recovered}','true')),'MOBILE_REPLAY_MISMATCH');
 perform timesheet_expect('select upload_mobile_work(mobile_test_payload(2))','MOBILE_TIME_OVERLAP');
 perform timesheet_expect('update mobile_work_sessions set work_seconds=1000','permission denied');
 perform timesheet_expect('select save_work_site(''aa100000-0000-0000-0000-000000000001'',0,''Office'',31.5,74.3,200,true)','MOBILE_FORBIDDEN');
end$$;
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select save_work_site('aa100000-0000-0000-0000-000000000001',0,'Office',31.5,74.3,200,true);
do $$begin if jsonb_array_length(mobile_work_context()->'sites')<>1 then raise exception 'Work sites missing'; end if;end$$;
select timesheet_expect('select save_work_site(''aa100000-0000-0000-0000-000000000001'',0,''Changed'',31.5,74.3,200,true)','MOBILE_STALE');
select timesheet_expect('select save_work_site(''aa100000-0000-0000-0000-000000000002'',0,''Invalid'',91,74.3,200,true)','MOBILE_INPUT_INVALID');
reset role;
-- A caller-supplied UUID cannot overwrite a different tenant's work site.
begin;
insert into organizations(id,name) values('99600000-0000-0000-0000-000000000001','Other mobile tenant');
insert into work_sites(id,organization_id,name,latitude,longitude,radius_m,active,version) values('aa100000-0000-0000-0000-000000000099','99600000-0000-0000-0000-000000000001','Other tenant',0,0,200,true,1);
set local role authenticated;
select timesheet_expect('select save_work_site(''aa100000-0000-0000-0000-000000000099'',0,''Hijacked'',31.5,74.3,200,true)','duplicate key');
reset role;
do $$begin if not exists(select 1 from work_sites where id='aa100000-0000-0000-0000-000000000099' and name='Other tenant' and version=1) then raise exception 'Cross-tenant site modified';end if;end$$;
rollback;
-- Restrict organization history independently of attendance viewing.
begin;
insert into user_permissions(membership_id,permission_key,allowed) select id,'monitoring.view',false from memberships where user_id='99100000-0000-0000-0000-000000000012' and user_type='admin';
set local role authenticated;
do $$begin if exists(select 1 from mobile_work_sessions) then raise exception 'GPS history denial ignored'; end if;end$$;
reset role;
rollback;
-- Invalid coordinates must roll back work-log inserts in the same transaction.
begin;
select set_config('request.jwt.claims',timesheet_test_claims('admin'),true);
set local role authenticated;
select timesheet_expect(format('select upload_mobile_work(%L::jsonb)',jsonb_set(mobile_test_payload(3),'{points,0,lat}','91')),'MOBILE_INPUT_INVALID');
do $$begin if exists(select 1 from task_time_logs where id=md5('segment3')::uuid) then raise exception 'Invalid GPS left time behind'; end if;end$$;
reset role;
rollback;
-- A UTC Monday boundary creates separate time-log rows without losing seconds.
begin;
select set_config('request.jwt.claims',timesheet_test_claims('admin'),true);
set local role authenticated;
do $$declare boundary timestamptz:=(date_trunc('week',now() at time zone 'UTC') at time zone 'UTC'); payload jsonb; begin
 if boundary-interval '1 second'<now()-interval '7 days' then return; end if;
 payload:=jsonb_build_object('id',md5('mobile-week-boundary')::uuid,'recovered',false,'points','[]'::jsonb,'segments',jsonb_build_array(jsonb_build_object('id',md5('mobile-week-segment')::uuid,'start',to_char(boundary-interval '1 second','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'end',to_char(boundary+interval '1 second','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
 perform upload_mobile_work(payload);
 if (select sum(seconds) from task_time_logs where source='mobile_timer' and user_type='admin')<>2 or (select count(distinct timesheet_week_of(started_at)) from task_time_logs where source='mobile_timer' and user_type='admin')<>2 then raise exception 'Mobile UTC week allocation invalid'; end if;
end$$;
reset role;
rollback;
-- Existing retention removes GPS payloads while preserving timesheet business data.
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select set_tracking_retention('99100000-0000-0000-0000-000000000001','custom',1,true);
reset role;
update mobile_work_sessions set ended_at=now()-interval '2 days',started_at=now()-interval '2 days 1 minute';
select sweep_tracking_retention('99100000-0000-0000-0000-000000000001',100);
do $$begin if exists(select 1 from mobile_work_sessions) then raise exception 'Expired mobile GPS remained'; end if;if not exists(select 1 from task_time_logs where source='mobile_timer')then raise exception 'Retention deleted recorded work';end if;end$$;
select 'mobile field tracking SQL contracts passed' as result;
