\ir current_profile_authority.sql
create table task_time_logs(id uuid primary key default gen_random_uuid(),organization_id uuid not null,developer_id uuid,task_id uuid references developer_tasks(id),project_id uuid,started_at timestamptz not null,ended_at timestamptz,seconds integer,is_billable boolean not null default true);
alter table task_time_logs enable row level security;
grant select,insert,update,delete on task_time_logs to authenticated;
-- Exact pre-existing 018 write/read policies; new restrictive guards coexist.
create policy task_time_logs_read on public.task_time_logs for select to authenticated using (organization_id = public.auth_org() and not public.auth_is_client());
create policy task_time_logs_insert on public.task_time_logs for insert to authenticated with check (organization_id = public.auth_org() and not public.auth_is_client() and (developer_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin')));
create policy task_time_logs_update on public.task_time_logs for update to authenticated using (organization_id = public.auth_org() and (developer_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin'))) with check (organization_id = public.auth_org());
create policy task_time_logs_delete on public.task_time_logs for delete to authenticated using (organization_id = public.auth_org() and (developer_id = public.auth_app_user_id() or public.auth_role() in ('owner','admin')));
create function auth_org_unlocked() returns boolean language sql as $$select true$$;
create function app_private.org_unlocked(uuid) returns boolean language sql stable as $$select coalesce(nullif(current_setting('test.billing_locked',true),''),'no')<>'yes'$$;
\ir ../../database/077_timesheet_approval.sql
grant select,insert,update,delete on timesheets to authenticated;
insert into organizations(id,name) values('99100000-0000-0000-0000-000000000001','Timesheet fixture');
insert into developers values('99100000-0000-0000-0000-000000000011','99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000091');
insert into admin_users values('99100000-0000-0000-0000-000000000011','99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000092'),
 ('99100000-0000-0000-0000-000000000012','99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000093');
insert into memberships(organization_id,user_id,user_type,role,status) values
 ('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer','developer','active'),
 ('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','admin','admin','active'),
 ('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000012','admin','owner','active');
insert into auth.users(id,raw_app_meta_data) select p.auth_user_id,jsonb_build_object('organization_id',p.organization_id,'app_user_id',p.id,'user_type',p.kind,'role',m.role)
 from (select id,organization_id,auth_user_id,'admin' kind from admin_users union all select id,organization_id,auth_user_id,'developer' from developers) p
 join memberships m on m.organization_id=p.organization_id and m.user_id=p.id and m.user_type=p.kind where p.organization_id='99100000-0000-0000-0000-000000000001';
insert into task_time_logs(organization_id,developer_id,started_at,ended_at,seconds) values('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','2026-09-07T10:00Z','2026-09-07T11:00Z',3600),
 ('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000012','2026-09-07T10:00Z','2026-09-07T11:00Z',3600);
\ir ../../supabase/migrations/20260912100844_production_transactional_timesheet_review.sql
create function timesheet_test_claims(kind text default 'developer') returns text language sql security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('sub',u.id,'app_metadata',u.raw_app_meta_data)::text from auth.users u where u.id=case when kind='developer' then '99100000-0000-0000-0000-000000000091'::uuid when kind='admin' then '99100000-0000-0000-0000-000000000092'::uuid else '99100000-0000-0000-0000-000000000093'::uuid end $$;
create function timesheet_expect(command text,prefix text) returns void language plpgsql as $$begin
 begin execute command; exception when others then if sqlerrm like prefix||'%' then return; end if; raise; end;
 raise exception 'Expected % from %',prefix,command;
end $$;
do $$ begin
 if (select user_type from task_time_logs where developer_id='99100000-0000-0000-0000-000000000011') is not null then raise exception 'Ambiguous legacy identity guessed'; end if;
 if (select user_type from task_time_logs where developer_id='99100000-0000-0000-0000-000000000012')<>'admin' then raise exception 'Unambiguous admin not recovered'; end if;
end $$;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
select timesheet_expect('select submit_timesheet_week(''2026-09-07'')','TIMESHEET_IDENTITY_REVIEW_REQUIRED');
reset role;
select set_config('request.jwt.claims','{}',false);
-- Large authoritative history is seeded without repeating expensive Auth
-- fixtures 1,001 times; actual caller writes are exercised separately.
insert into task_time_logs(organization_id,developer_id,user_type,started_at,ended_at,seconds) select '99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','developer','2026-09-14T10:00Z','2026-09-14T10:00:01Z',1 from generate_series(1,1001);
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
insert into task_time_logs(organization_id,developer_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'2026-09-14T10:00Z','2026-09-14T10:00:01Z',1);
select submit_timesheet_week('2026-09-14');
do $$ begin if (select total_seconds from timesheets where week_start='2026-09-14')<>1002 then raise exception 'Submission capped logs'; end if; end $$;
select timesheet_expect('update task_time_logs set started_at=''2026-09-21T10:00Z'',ended_at=''2026-09-21T10:01Z'' where started_at=''2026-09-14T10:00Z''','TIMESHEET_WEEK_LOCKED');
select timesheet_expect('delete from timesheets','permission denied');
select timesheet_expect('update timesheets set total_seconds=99','permission denied');
select timesheet_expect('select submit_timesheet_week(''2026-09-14'')','TIMESHEET_STATE_CONFLICT');
reset role;
-- A colliding admin UUID is a different person/type, with separate logs/week.
select set_config('request.jwt.claims',timesheet_test_claims('admin'),false);
set role authenticated;
insert into task_time_logs(organization_id,developer_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'2026-09-14T11:00Z','2026-09-14T11:01Z',60);
select submit_timesheet_week('2026-09-14');
select timesheet_expect('select decide_timesheet((select id from timesheets where user_type=''admin''),''approved'',null)','TIMESHEET_SELF_DECISION');
select decide_timesheet((select id from timesheets where user_type='developer'),'approved',null);
reset role;
select timesheet_expect('delete from timesheets where user_type=''developer''','TIMESHEET_WEEK_LOCKED');
select set_config('request.jwt.claims',timesheet_test_claims('owner'),false);
set role authenticated;
select decide_timesheet((select id from timesheets where user_type='developer'),'reopen','Correction');
select decide_timesheet((select id from timesheets where user_type='admin'),'rejected','Needs correction');
reset role;
insert into user_permissions(membership_id,permission_key,allowed) select id,'timesheet.approve',false from memberships where user_id='99100000-0000-0000-0000-000000000012';
set role authenticated;
select timesheet_expect('select decide_timesheet((select id from timesheets where user_type=''admin''),''reopen'',null)','TIMESHEET_FORBIDDEN');
reset role;
select set_config('request.jwt.claims',timesheet_test_claims('developer'),false);
set role authenticated;
update task_time_logs set seconds=2 where id=(select id from task_time_logs where started_at='2026-09-14T10:00Z' limit 1);
select submit_timesheet_week('2026-09-14');
select set_config('test.billing_locked','yes',false);
select timesheet_expect('select submit_timesheet_week(''2026-09-21'')','BILLING_LOCKED');
select set_config('test.billing_locked','no',false);
select timesheet_expect('select submit_timesheet_week(''2026-09-22'')','TIMESHEET_WEEK_INVALID');
select timesheet_expect('select submit_timesheet_week(''2026-09-21'')','TIMESHEET_EMPTY');
insert into task_time_logs(organization_id,developer_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'2026-09-21T10:00Z',null,null);
select timesheet_expect('select submit_timesheet_week(''2026-09-21'')','TIMESHEET_OPEN_LOGS');
update task_time_logs set ended_at='2026-09-21T11:00Z',seconds=3600 where started_at='2026-09-21T10:00Z';
reset role;
begin;
update memberships set role='finance' where user_id='99100000-0000-0000-0000-000000000012';
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}','"finance"') where id='99100000-0000-0000-0000-000000000093';
select set_config('request.jwt.claims',timesheet_test_claims('owner'),true);
set local role authenticated;
do $$ begin if not auth_timesheet_permission('timesheet.view_all') or auth_timesheet_permission('timesheet.approve') then raise exception 'Finance catalogue mismatch'; end if; end $$;
reset role;
rollback;
-- The existing authorized deletion lifecycle can still remove locked history.
begin;
grant all on timesheets,task_time_logs to service_role;
set local role service_role;
select start_organization_deletion('99100000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000012','admin','99100000-0000-0000-0000-000000000093','Timesheet fixture',repeat('f',64));
select set_config('request.jwt.claims','{}',true);
delete from task_time_logs where organization_id='99100000-0000-0000-0000-000000000001';
delete from timesheets where organization_id='99100000-0000-0000-0000-000000000001';
reset role;
rollback;

begin;
insert into projects(id,organization_id,name) values('99200000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000001','Own work');
insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,status) values('99200000-0000-0000-0000-000000000011','99100000-0000-0000-0000-000000000001','99200000-0000-0000-0000-000000000001','99100000-0000-0000-0000-000000000011','Task','pending');
select set_config('request.jwt.claims',timesheet_test_claims('developer'),true);
set local role authenticated;
select timesheet_expect('insert into task_time_logs(organization_id,developer_id,task_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),''99200000-0000-0000-0000-000000000011'',''2026-09-28T10:00Z'',''2026-09-28T11:00Z'',3600)','TIMESHEET_TASK_INVALID');
select timesheet_expect('insert into task_time_logs(organization_id,developer_id,project_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),''99200000-0000-0000-0000-000000000099'',''2026-09-28T10:00Z'',''2026-09-28T11:00Z'',3600)','TIMESHEET_PROJECT_INVALID');
insert into task_time_logs(organization_id,developer_id,task_id,project_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'99200000-0000-0000-0000-000000000011','99200000-0000-0000-0000-000000000001','2026-09-28T10:00Z','2026-09-28T11:00Z',3600);
reset role;
rollback;
