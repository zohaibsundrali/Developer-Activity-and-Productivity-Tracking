#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mobile_container="tracking-mobile-test-$$"
trap 'docker stop "$mobile_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$mobile_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
  if [[ $(docker logs "$mobile_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$mobile_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
docker exec "$mobile_container" psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/mobile_field_tracking.sql
