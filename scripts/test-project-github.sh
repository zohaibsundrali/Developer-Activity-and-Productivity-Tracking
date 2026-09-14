#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
github_container="tracking-github-test-$$"
trap 'docker stop "$github_container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$github_container" --network none -v "$PWD:/workspace:ro" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
  if [[ $(docker logs "$github_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$github_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
docker exec "$github_container" psql -U postgres -v ON_ERROR_STOP=1 -f /workspace/database/tests/project_github_link.sql
python3 scripts/test-github-link-concurrency.py "$github_container"
