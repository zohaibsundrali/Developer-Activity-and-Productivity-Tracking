#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exception_container="tracking-exception-test-$$"
trap 'docker stop "$exception_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$exception_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
  if [[ $(docker logs "$exception_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$exception_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
docker exec "$exception_container" psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/shift_attendance_exceptions.sql
