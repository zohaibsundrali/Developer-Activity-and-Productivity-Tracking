#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
coowner_container="tracking-coowners-$$"
trap 'docker stop "$coowner_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$coowner_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
 if [[ $(docker logs "$coowner_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$coowner_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 0.2
done
docker exec "$coowner_container" psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/organization_co_owners.sql

python3 scripts/test-coowner-concurrency.py "$coowner_container"
