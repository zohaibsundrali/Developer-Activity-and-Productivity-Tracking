begin;
-- Application conflicts are permanent for this input, not serialization failures.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely. PT409 gives direct RPC callers
-- an immediate HTTP 409 and keeps genuine PostgreSQL serialization errors intact.
-- Preserve current bodies, security modes and ACLs, including earlier repairs.
do $repair$
declare f record; definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and (n.nspname||'.'||p.proname) = any(array[
   'app_private.save_work_shift','app_private.save_project_github',
   'app_private.upload_mobile_work','app_private.review_shift_attendance',
   'public.sync_github_issue_task','app_private.save_work_site',
   'app_private.reserve_github_issue_task','app_private.guard_github_issue_sync',
   'public.apply_actor_automation_action','public.guard_leave_request',
   'public.reserve_profile_provision','public.operator_repair_profile_identity',
   'app_private.start_tracker_presence_stream','app_private.heartbeat_tracker_presence'
  ])
 loop
  definition := pg_get_functiondef(f.oid);
  definition := regexp_replace(definition, $pattern$errcode\s*=\s*'40001'$pattern$, 'errcode=''PT409''', 'gi');
  execute definition;
 end loop;
end $repair$;
notify pgrst, 'reload schema';
commit;
