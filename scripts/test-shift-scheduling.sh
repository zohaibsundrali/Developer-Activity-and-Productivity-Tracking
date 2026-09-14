#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
shift_container="tracking-shift-test-$$"
trap 'docker stop "$shift_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$shift_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
  if [[ $(docker logs "$shift_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$shift_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
docker exec "$shift_container" psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/work_shift_scheduling.sql
python3 scripts/test-shift-concurrency.py "$shift_container"
