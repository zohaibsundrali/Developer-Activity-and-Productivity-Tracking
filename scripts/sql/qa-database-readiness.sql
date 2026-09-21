-- Read-only. Run as the project database administrator before applying repairs.
-- No customer/Auth data or secret values are returned.
with expected(kind, object_name, migration) as (values
 ('table','app_private.storage_legacy_unassigned','20260921062832_restore_storage_usage_ledger.sql'),
 ('table','app_private.storage_usage','20260921062832_restore_storage_usage_ledger.sql'),
 ('function','public.raise_timesheet_invoice(uuid,jsonb,uuid,text,date)','20260912110551_production_transactional_typed_invoicing.sql'),
 ('function','public.record_attendance(text,date,uuid,text,text,text)','20260912113733_production_transactional_attendance.sql'),
 ('function','public.report_data(date,date,text,integer,integer)','20260912124428_production_scalable_report_aggregates.sql'),
 ('table','public.work_shifts','20260914074151_production_work_shift_scheduling.sql'),
 ('table','public.work_shift_events','20260914074151_production_work_shift_scheduling.sql'),
 ('function','public.work_shift_staff(text,text,uuid)','20260914074151_production_work_shift_scheduling.sql'),
 ('function','public.auth_attendance_permission(text)','20260911180705_production_typed_leave_authority.sql'),
 ('function','public.approved_time_export(date,date)','20260914082024_production_approved_time_export.sql'),
 ('table','public.project_github_links','20260914083031_production_project_github_link.sql'),
 ('table','public.work_sites','20260914085225_production_mobile_field_tracking.sql'),
 ('table','public.mobile_work_sessions','20260914085225_production_mobile_field_tracking.sql'),
 ('table','public.shift_attendance_reviews','20260914174305_production_shift_attendance_exceptions.sql'),
 ('function','public.shift_attendance_report(date,date,text,integer,integer)','20260914174305_production_shift_attendance_exceptions.sql'),
 ('table','public.github_issue_task_imports','20260914182129_production_github_issue_task_import.sql'),
 ('table','public.github_issue_task_syncs','20260914185642_production_github_issue_task_sync.sql'),
 ('table','app_private.billing_accounts','20260920070343_shared_account_billing.sql'),
 ('table','app_private.organization_billing','20260920070343_shared_account_billing.sql'),
 ('function','public.billing_scope(uuid)','20260920070343_shared_account_billing.sql')
), resolved as (
 select *, case when kind='table' then to_regclass(object_name)::oid
                else to_regprocedure(object_name)::oid end object_id from expected
)
select kind,object_name,migration,
 case when object_id is null then 'MISSING' else 'PRESENT' end status,
 case when kind='table' then (select relrowsecurity from pg_class where oid=object_id) end rls_enabled,
 case when kind='function' and object_id is not null then has_function_privilege('service_role',object_id,'EXECUTE') end service_can_execute,
 case when kind='function' and object_id is not null then has_function_privilege('authenticated',object_id,'EXECUTE') end authenticated_can_execute
from resolved order by migration,object_name;
