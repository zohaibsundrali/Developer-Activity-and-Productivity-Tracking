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
  database/tests/notification_recipient.sql \
  database/tests/membership_authority_fixture.sql \
  supabase/migrations/20260911044517_audit_membership_authority.sql \
  database/tests/membership_authority.sql; do
  docker exec -i "$audit_container" psql -U postgres -v ON_ERROR_STOP=1 < "$sql_file"
done
docker exec "$audit_container" createdb -U postgres quota_test
for sql_file in \
  database/tests/quota_fixture.sql \
  supabase/migrations/20260911055537_production_quota_enforcement.sql \
  database/tests/quota.sql; do
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
  database/tests/permission_fields.sql; do
  docker exec -i "$audit_container" psql -U postgres -d quota_test -v ON_ERROR_STOP=1 < "$sql_file"
done
