#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sync_container="tracking-input-receipts-test-$$"
trap 'docker stop "$sync_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$sync_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
  if [[ $(docker logs "$sync_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$sync_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
docker exec "$sync_container" psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/input_capture_receipts.sql
