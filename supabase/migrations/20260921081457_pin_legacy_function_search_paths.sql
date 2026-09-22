begin;
-- Reviewed legacy functions use only builtins and public/auth-qualified objects.
-- Explicit pg_temp last prevents temporary objects shadowing intended relations.
-- ALTER preserves bodies, ownership, security modes, volatility and existing ACLs.
do $repair$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.proname=any(array[
  'derive_notification_category',
  'calculate_project_productivity',
  'update_updated_at_column',
  'calculate_overall_productivity',
  'update_project_progress',
  'try_uuid',
  'auth_monitoring_sees_all',
  'timesheet_week_of',
  'auth_user_type',
  'auth_app_user_id',
  'auth_is_client',
  'auth_client_project_ids',
  'plan_limit_int',
  'monitoring_row_visible',
  'test_run_closed',
  'tg_change_request_guard',
  'tg_project_closure_guard',
  'asset_status_follows_holder',
  'review_cycle_closed',
  'candidate_normalise_email',
  'candidate_outcome_final',
  'contract_terms_frozen'
 ]) loop
  execute format('alter function %s set search_path = pg_catalog, public, pg_temp',f.signature);
 end loop;
end $repair$;
notify pgrst, 'reload schema';
commit;
