#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
storage_container="tracking-legacy-storage-test-$$"
trap 'docker stop "$storage_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$storage_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
  if [[ $(docker logs "$storage_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$storage_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
docker exec "$storage_container" psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/preserved_legacy_storage.sql
