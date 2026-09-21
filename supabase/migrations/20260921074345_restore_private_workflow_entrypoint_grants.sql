begin;
-- Shared billing revoked every private EXECUTE grant, breaking existing invoker
-- wrappers. Restore only the guarded entrypoints originally granted by their
-- feature migrations. No private table, trigger or billing helper is exposed.
grant usage on schema app_private to authenticated;
do $repair$ declare signature text; target regprocedure; begin
 foreach signature in array array[
  'app_private.save_work_shift(uuid,integer,uuid,text,timestamptz,timestamptz,text,text,text,text)',
  'app_private.work_shift_staff(text,text,uuid)',
  'app_private.approved_time_export(date,date)',
  'app_private.can_read_project_github(uuid)',
  'app_private.save_project_github(uuid,integer,bigint,text,text)',
  'app_private.save_work_site(uuid,integer,text,double precision,double precision,integer,boolean)',
  'app_private.upload_mobile_work(jsonb)',
  'app_private.shift_attendance_report(date,date,text,integer,integer)',
  'app_private.review_shift_attendance(uuid,uuid,text,integer,integer,text,text)',
  'app_private.reserve_github_issue_task(uuid,integer,jsonb,date,date)',
  'app_private.get_tracker_presence_epoch()',
  'app_private.start_tracker_presence_stream(uuid,uuid,text)',
  'app_private.heartbeat_tracker_presence(uuid,bigint,text)',
  'app_private.monitoring_tracker_presence(uuid,uuid)'] loop
  target:=to_regprocedure(signature);
  -- Some installations have not enabled every optional feature yet.
  if target is not null then
   execute format('revoke all on function %s from public,anon',target);
   execute format('grant execute on function %s to authenticated',target);
  end if;
 end loop;
end $repair$;

-- The invoker GitHub sync must obtain the shared quota lock without gaining
-- access to arbitrary organizations' billing internals. This argument-free
-- bridge binds the existing lock to the verified caller's current workspace.
create or replace function app_private.lock_own_workflow_quota() returns void
language plpgsql security definer set search_path=pg_catalog,public,app_private as $lock$
declare org uuid:=public.auth_org();
begin
 if auth.uid() is null or org is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 perform app_private.lock_quota(org);
end $lock$;
revoke all on function app_private.lock_own_workflow_quota() from public,anon;
grant execute on function app_private.lock_own_workflow_quota() to authenticated;
-- Keep the sync function's caller privileges/RLS and all its existing guards.
do $sync$ declare target regprocedure:=to_regprocedure('public.sync_github_issue_task(uuid,uuid,uuid,integer,text,jsonb,text,text)'); definition text; begin
 if target is not null then
  definition:=pg_get_functiondef(target);
  if position('app_private.lock_quota(public.auth_org())' in definition)>0 then
   execute replace(definition,'app_private.lock_quota(public.auth_org())','app_private.lock_own_workflow_quota()');
  elsif position('app_private.lock_own_workflow_quota()' in definition)=0 then
   raise exception 'Unexpected GitHub sync definition; review before applying grants repair';
  end if;
 end if;
end $sync$;
commit;
