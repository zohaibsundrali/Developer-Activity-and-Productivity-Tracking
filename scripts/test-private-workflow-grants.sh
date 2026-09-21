#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
grants_container="tracking-workflow-grants-$$"
trap 'docker stop "$grants_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$grants_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
 if [[ $(docker logs "$grants_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$grants_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 0.2
done
for fixture in shared_account_billing mobile_field_tracking github_issue_task_sync tracker_device_presence shift_attendance_exceptions; do
 docker exec "$grants_container" createdb -U postgres "$fixture"
 docker exec "$grants_container" psql -U postgres -d "$fixture" -v ON_ERROR_STOP=1 -f "/workspace/database/tests/$fixture.sql"
 # Reproduce the former billing regression, then apply the actual repair.
 docker exec "$grants_container" psql -U postgres -d "$fixture" -v ON_ERROR_STOP=1 -c 'revoke all on all functions in schema app_private from public,anon,authenticated;'
 docker exec "$grants_container" psql -U postgres -d "$fixture" -v ON_ERROR_STOP=1 -f /workspace/supabase/migrations/20260921074345_restore_private_workflow_entrypoint_grants.sql
 docker exec "$grants_container" psql -U postgres -d "$fixture" -v ON_ERROR_STOP=1 -f /workspace/supabase/migrations/20260921080704_avoid_retrying_application_conflicts.sql
 docker exec "$grants_container" psql -U postgres -d "$fixture" -v ON_ERROR_STOP=1 -f /workspace/supabase/migrations/20260921081457_pin_legacy_function_search_paths.sql
 docker exec -i "$grants_container" psql -U postgres -d "$fixture" -v ON_ERROR_STOP=1 < database/tests/private_workflow_grants.sql
 done
