#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dependency_container="tracking-dependency-pg-$$"
trap 'docker stop "$dependency_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$dependency_container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
 if [[ $(docker logs "$dependency_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$dependency_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 0.2
done
sed '/^\\ir /r supabase/migrations/20260925072952_task_dependency_cycle_guard.sql' database/tests/task_dependency_cycle.sql | sed '/^\\ir /d' | docker exec -i "$dependency_container" psql -U postgres -v ON_ERROR_STOP=1
python3 scripts/test-task-dependency-concurrency.py "$dependency_container" postgres

docker exec "$dependency_container" createdb -U postgres saved_view_test
sed '/^\\ir /r supabase/migrations/20260925074540_saved_view_owner_isolation.sql' database/tests/saved_view_owner_isolation.sql | sed '/^\\ir /d' | docker exec -i "$dependency_container" psql -U postgres -d saved_view_test -v ON_ERROR_STOP=1
