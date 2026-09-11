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
