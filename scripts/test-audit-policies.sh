#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
audit_container="tracking-audit-pg-$$"
trap 'docker stop "$audit_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$audit_container" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
  # The image starts a temporary server during initialization; wait until it
  # has shut down and the final server has started before sending test SQL.
  if [[ $(docker logs "$audit_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] &&
     docker exec "$audit_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
for sql_file in \
  database/tests/notification_recipient_fixture.sql \
  supabase/migrations/20260911042612_audit_notification_recipient_isolation.sql \
  supabase/migrations/20260911081955_production_notification_update_guard.sql \
  database/tests/notification_recipient.sql \
  database/tests/notification_update.sql \
  database/tests/membership_authority_fixture.sql \
  supabase/migrations/20260911044517_audit_membership_authority.sql \
  database/tests/membership_authority.sql; do
  docker exec -i "$audit_container" psql -U postgres -v ON_ERROR_STOP=1 < "$sql_file"
done
docker exec "$audit_container" createdb -U postgres quota_test
for sql_file in \
  database/tests/quota_fixture.sql \
  supabase/migrations/20260911055537_production_quota_enforcement.sql \
  supabase/migrations/20260911083056_production_delivery_write_lock.sql \
  database/tests/quota.sql \
  database/tests/delivery_write_lock.sql; do
  docker exec -i "$audit_container" psql -U postgres -d quota_test -v ON_ERROR_STOP=1 < "$sql_file"
done
python3 scripts/test-quota-concurrency.py "$audit_container"
for sql_file in \
  database/tests/feature_history_fixture.sql \
  supabase/migrations/20260911060849_production_feature_history_guards.sql \
  database/tests/feature_history.sql \
  database/tests/storage_fixture.sql \
  supabase/migrations/20260911062113_production_storage_accounting.sql \
  database/tests/storage.sql \
  database/tests/device_fixture.sql \
  supabase/migrations/20260911062805_production_device_sessions.sql \
  database/tests/device.sql \
  database/tests/invitation_fixture.sql \
  supabase/migrations/20260911063616_production_invitation_transactions.sql \
  database/tests/invitation.sql \
  database/tests/permission_fields_fixture.sql \
  supabase/migrations/20260911065148_production_permission_field_guards.sql \
  database/tests/permission_fields.sql \
  database/tests/project_staffing_fixture.sql \
  supabase/migrations/20260911071332_production_project_staffing_permissions.sql \
  database/tests/project_staffing.sql \
  database/tests/typed_permission_fixture.sql \
  supabase/migrations/20260911072728_production_typed_permission_identity.sql \
  database/tests/typed_permission.sql \
  database/tests/invitation_authority_fixture.sql \
  supabase/migrations/20260911074242_production_invitation_authority.sql \
  database/tests/invitation_authority.sql; do
  docker exec -i "$audit_container" psql -U postgres -d quota_test -v ON_ERROR_STOP=1 < "$sql_file"
done
for sql_file in \
  supabase/migrations/20260911083449_production_task_review_integrity.sql \
  database/tests/task_review_integrity.sql; do
  docker exec -i "$audit_container" psql -U postgres -d quota_test -v ON_ERROR_STOP=1 < "$sql_file"
done
for sql_file in \
  database/tests/task_plan_fixture.sql \
  supabase/migrations/20260911083905_production_task_plan_transaction.sql \
  database/tests/task_plan_transaction.sql; do
  docker exec -i "$audit_container" psql -U postgres -d quota_test -v ON_ERROR_STOP=1 < "$sql_file"
done
for sql_file in \
  database/tests/review_transaction_fixture.sql \
  supabase/migrations/20260911094725_production_submission_write_authority.sql \
  supabase/migrations/20260911085808_production_review_transaction.sql \
  database/tests/review_transaction.sql; do
  docker exec -i "$audit_container" psql -U postgres -d quota_test -v ON_ERROR_STOP=1 < "$sql_file"
done
for sql_file in \
  supabase/migrations/20260911090852_production_submission_transaction.sql \
  database/tests/submission_transaction.sql; do
  docker exec -i "$audit_container" psql -U postgres -d quota_test -v ON_ERROR_STOP=1 < "$sql_file"
done

# Standalone adversarial fixture retains intentionally broad legacy policies.
docker exec "$audit_container" createdb -U postgres submission_authority_test
sed '/^\\ir /r supabase/migrations/20260911094725_production_submission_write_authority.sql' \
  database/tests/submission_write_authority.sql | sed '/^\\ir /d' | \
  docker exec -i "$audit_container" psql -U postgres -d submission_authority_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres comment_integrity_test
sed '/^\\ir /r supabase/migrations/20260911095524_production_task_comment_integrity.sql' \
  database/tests/task_comment_integrity.sql | sed '/^\\ir /d' | \
  docker exec -i "$audit_container" psql -U postgres -d comment_integrity_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres proof_objects_test
sed '/^\\ir /r supabase/migrations/20260911095840_production_proof_object_immutability.sql' \
  database/tests/proof_object_immutability.sql | sed '/^\\ir /d' | \
  docker exec -i "$audit_container" psql -U postgres -d proof_objects_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres typed_notification_test
for sql_file in \
  database/tests/typed_notification_fixture.sql \
  supabase/migrations/20260911095635_production_typed_notification_recipients.sql \
  database/tests/typed_notification.sql \
  scripts/sql/notification-recipient-preflight.sql \
  database/tests/notification_state_fixture.sql \
  supabase/migrations/20260911102420_production_notification_recipient_state.sql \
  database/tests/notification_state.sql; do
  docker exec -i "$audit_container" psql -U postgres -d typed_notification_test -v ON_ERROR_STOP=1 < "$sql_file"
done

docker exec "$audit_container" createdb -U postgres task_authority_test
sed -e '/^\\ir task_authorization_fixture.sql/r database/tests/task_authorization_fixture.sql' \
  -e '/^\\ir .*20260911100211/r supabase/migrations/20260911100211_production_task_authorization.sql' \
  -e '/^\\ir .*20260911083449/r supabase/migrations/20260911083449_production_task_review_integrity.sql' \
  database/tests/task_authorization.sql | sed '/^\\ir /d' | \
  docker exec -i "$audit_container" psql -U postgres -d task_authority_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres attachment_authority_test
sed '/^\\ir /r supabase/migrations/20260911100934_production_task_attachment_integrity.sql' \
  database/tests/task_attachment_integrity.sql | sed '/^\\ir /d' | \
  docker exec -i "$audit_container" psql -U postgres -d attachment_authority_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres project_authority_test
sed -e '/^\\ir task_authorization_fixture.sql/r database/tests/task_authorization_fixture.sql' \
  -e '/^\\ir .*20260911101008/r supabase/migrations/20260911101008_production_project_mutation_authority.sql' \
  database/tests/project_mutation_authority.sql | sed '/^\\ir /d' | \
  docker exec -i "$audit_container" psql -U postgres -d project_authority_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres pm_storage_test
python3 scripts/expand-sql-fixture.py database/tests/pm_storage_task_scope.sql | \
  docker exec -i "$audit_container" psql -U postgres -d pm_storage_test -v ON_ERROR_STOP=1
# Confirm the actual migration refuses a public bucket before any policy DDL.
docker exec "$audit_container" psql -U postgres -d pm_storage_test -v ON_ERROR_STOP=1 \
  -c "update storage.buckets set public=true where id='task-submissions'" >/dev/null
if pm_preflight_result=$(docker exec -i "$audit_container" psql -U postgres -d pm_storage_test -v ON_ERROR_STOP=1 \
  < supabase/migrations/20260911102625_production_pm_storage_task_scope.sql 2>&1); then
  printf '%s\n' 'Public task bucket was incorrectly accepted' >&2
  exit 1
fi
if [[ "$pm_preflight_result" != *TASK_BUCKET_PUBLIC* ]]; then
  printf '%s\n' "$pm_preflight_result" >&2
  exit 1
fi

docker exec "$audit_container" createdb -U postgres quality_transactions_test
python3 scripts/expand-sql-fixture.py database/tests/quality_transactions.sql | \
  docker exec -i "$audit_container" psql -U postgres -d quality_transactions_test -v ON_ERROR_STOP=1
python3 scripts/test-quality-concurrency.py "$audit_container" quality_transactions_test

docker exec "$audit_container" createdb -U postgres task_visibility_test
python3 scripts/expand-sql-fixture.py database/tests/task_visibility_permission.sql | \
  docker exec -i "$audit_container" psql -U postgres -d task_visibility_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres quality_authority_test
python3 scripts/expand-sql-fixture.py database/tests/quality_authority.sql | \
  docker exec -i "$audit_container" psql -U postgres -d quality_authority_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres task_relationship_test
python3 scripts/expand-sql-fixture.py database/tests/task_relationship_integrity.sql | \
  docker exec -i "$audit_container" psql -U postgres -d task_relationship_test -v ON_ERROR_STOP=1
docker exec -i "$audit_container" psql -U postgres -d task_relationship_test -v ON_ERROR_STOP=1 < scripts/sql/task-relationship-preflight.sql

docker exec "$audit_container" createdb -U postgres task_collaboration_test
python3 scripts/expand-sql-fixture.py database/tests/task_collaboration_authority.sql | \
  docker exec -i "$audit_container" psql -U postgres -d task_collaboration_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres task_watcher_test
python3 scripts/expand-sql-fixture.py database/tests/task_watcher_authority.sql | \
  docker exec -i "$audit_container" psql -U postgres -d task_watcher_test -v ON_ERROR_STOP=1
python3 scripts/test-task-parent-concurrency.py "$audit_container" task_relationship_test

docker exec "$audit_container" createdb -U postgres project_clone_test
python3 scripts/expand-sql-fixture.py database/tests/project_clone_transaction.sql | \
  docker exec -i "$audit_container" psql -U postgres -d project_clone_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres existing_plan_test
python3 scripts/expand-sql-fixture.py database/tests/existing_plan_submission.sql | \
  docker exec -i "$audit_container" psql -U postgres -d existing_plan_test -v ON_ERROR_STOP=1
python3 scripts/test-existing-plan-concurrency.py "$audit_container" existing_plan_test

docker exec "$audit_container" createdb -U postgres typed_project_test
python3 scripts/expand-sql-fixture.py database/tests/typed_project_ownership.sql | \
  docker exec -i "$audit_container" psql -U postgres -d typed_project_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres plan_review_test
python3 scripts/expand-sql-fixture.py database/tests/task_plan_review_transaction.sql | \
  docker exec -i "$audit_container" psql -U postgres -d plan_review_test -v ON_ERROR_STOP=1
docker exec -i "$audit_container" psql -U postgres -d typed_project_test -v ON_ERROR_STOP=1 < scripts/sql/project-identity-preflight.sql
python3 scripts/test-plan-review-concurrency.py "$audit_container" plan_review_test

docker exec "$audit_container" createdb -U postgres typed_capacity_test
python3 scripts/expand-sql-fixture.py database/tests/typed_capacity_identity.sql | \
  docker exec -i "$audit_container" psql -U postgres -d typed_capacity_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres selected_capacity_test
python3 scripts/expand-sql-fixture.py database/tests/selected_week_capacity.sql | \
  docker exec -i "$audit_container" psql -U postgres -d selected_capacity_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres fractional_capacity_test
python3 scripts/expand-sql-fixture.py database/tests/fractional_single_day_capacity.sql | \
  docker exec -i "$audit_container" psql -U postgres -d fractional_capacity_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres typed_manager_roster_test
python3 scripts/expand-sql-fixture.py database/tests/typed_project_manager_roster.sql | \
  docker exec -i "$audit_container" psql -U postgres -d typed_manager_roster_test -v ON_ERROR_STOP=1
python3 scripts/test-manager-roster-concurrency.py "$audit_container" typed_manager_roster_test

docker exec "$audit_container" createdb -U postgres typed_monitoring_test
python3 scripts/expand-sql-fixture.py database/tests/typed_monitoring_read_permissions.sql | \
  docker exec -i "$audit_container" psql -U postgres -d typed_monitoring_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres notification_insert_test
python3 scripts/expand-sql-fixture.py database/tests/notification_insert_authority.sql | \
  docker exec -i "$audit_container" psql -U postgres -d notification_insert_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres assignment_notifications_test
python3 scripts/expand-sql-fixture.py database/tests/task_assignment_notifications.sql | \
  docker exec -i "$audit_container" psql -U postgres -d assignment_notifications_test -v ON_ERROR_STOP=1
python3 scripts/test-assignment-notification-concurrency.py "$audit_container" assignment_notifications_test

docker exec "$audit_container" createdb -U postgres task_notification_privacy_test
python3 scripts/expand-sql-fixture.py database/tests/task_notification_privacy.sql | \
  docker exec -i "$audit_container" psql -U postgres -d task_notification_privacy_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres agile_container_test
python3 scripts/expand-sql-fixture.py database/tests/agile_container_write_authority.sql | \
  docker exec -i "$audit_container" psql -U postgres -d agile_container_test -v ON_ERROR_STOP=1

docker exec "$audit_container" createdb -U postgres sensitive_notification_test
python3 scripts/expand-sql-fixture.py database/tests/sensitive_notification_privacy.sql | \
  docker exec -i "$audit_container" psql -U postgres -d sensitive_notification_test -v ON_ERROR_STOP=1

# Production gap regression: actual migrations, rollback and current recipient access.
for fixture in sprint_status_notifications notification_entity_privacy atomic_employee_save proposal_decision_transaction durable_actor_automation_jobs server_notification_event_guard work_transition_notices milestone_write_authority; do
  docker exec "$audit_container" createdb -U postgres "${fixture}_test"
  python3 scripts/expand-sql-fixture.py "database/tests/${fixture}.sql" | \
    docker exec -i "$audit_container" psql -U postgres -d "${fixture}_test" -v ON_ERROR_STOP=1
done

python3 scripts/test-proposal-decision-concurrency.py "$audit_container" proposal_decision_transaction_test

# Unattended jobs, destructive lifecycle recovery, and existing leave contract.
for fixture in unattended_actor_automation tracking_retention_jobs typed_leave_authority organization_deletion_lifecycle leave_day_contract leave_contract_capacity automation_retention_deletion_integration current_profile_authority invitation_cleanup_confirmation profile_provisioning operator_identity_repair transactional_signup_recovery completed_signup_cleanup atomic_recurring_tasks idempotent_screenshot_capture organization_screenshot_policy tracking_work_context tracking_break_history organization_idle_reminder_policy activity_aggregate_receipts input_capture_receipts tracking_event_history_timestamps tracking_event_retention_cleanup transactional_timesheet_review typed_time_log_capacity transactional_typed_invoicing transactional_attendance scalable_report_aggregates canonical_productivity_recalculation canonical_productivity_review screenshot_metadata_pages tracker_device_presence work_shift_scheduling approved_time_export project_github_link mobile_field_tracking shift_attendance_exceptions; do
  docker exec "$audit_container" createdb -U postgres "${fixture}_test"
  python3 scripts/expand-sql-fixture.py "database/tests/${fixture}.sql" | \
    docker exec -i "$audit_container" psql -U postgres -d "${fixture}_test" -v ON_ERROR_STOP=1
done
python3 scripts/test-presence-concurrency.py "$audit_container" tracker_device_presence_test
python3 scripts/test-leave-overlap-concurrency.py "$audit_container" typed_leave_authority_test
python3 scripts/test-identity-repair-concurrency.py "$audit_container" operator_identity_repair_test
python3 scripts/test-signup-recovery-concurrency.py "$audit_container" transactional_signup_recovery_test
python3 scripts/test-recurring-task-concurrency.py "$audit_container" atomic_recurring_tasks_test
python3 scripts/test-input-capture-concurrency.py "$audit_container" input_capture_receipts_test
python3 scripts/test-activity-aggregate-concurrency.py "$audit_container" activity_aggregate_receipts_test
python3 scripts/test-screenshot-capture-concurrency.py "$audit_container" idempotent_screenshot_capture_test

python3 scripts/test-organization-deletion-concurrency.py "$audit_container" organization_deletion_lifecycle_test

docker exec -i "$audit_container" psql -U postgres -d current_profile_authority_test -v ON_ERROR_STOP=1 < scripts/sql/current-identity-preflight.sql

python3 scripts/test-timesheet-concurrency.py "$audit_container" transactional_timesheet_review_test
docker exec -i "$audit_container" psql -U postgres -d transactional_timesheet_review_test -v ON_ERROR_STOP=1 < scripts/sql/timesheet-identity-preflight.sql

python3 scripts/test-invoicing-concurrency.py "$audit_container" transactional_typed_invoicing_test
docker exec -i "$audit_container" psql -U postgres -d transactional_typed_invoicing_test -v ON_ERROR_STOP=1 < scripts/sql/invoice-identity-preflight.sql

python3 scripts/test-invoice-bucket-privacy.py "$audit_container"

python3 scripts/test-attendance-concurrency.py "$audit_container"

python3 scripts/test-productivity-concurrency.py "$audit_container"
