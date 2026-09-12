#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence_container="missing-profile-evidence-$$"
evidence_output=$(mktemp -d)
trap 'docker stop "$evidence_container" >/dev/null 2>&1 || true; rm -rf "$evidence_output"' EXIT
docker run --rm -d --name "$evidence_container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in {1..100}; do
 if [[ $(docker logs "$evidence_container" 2>&1) == *"PostgreSQL init process complete; ready for start up."* ]] && docker exec "$evidence_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 0.2
done
python3 scripts/expand-sql-fixture.py database/tests/missing_profile_recovery_evidence.sql | docker exec -i "$evidence_container" psql -U postgres -At -v ON_ERROR_STOP=1 > "$evidence_output/result.log"
python3 - "$evidence_output/result.log" <<'PY'
import json, hashlib
from pathlib import Path
raw = Path(__import__('sys').argv[1]).read_text()
result=json.loads(next(line for line in raw.splitlines() if line.startswith('{')))
assert result['read_only'] is True
rows=result['missing_or_misplaced_profiles']
assert len(rows)==7
key=lambda label: str(__import__('uuid').UUID(hashlib.md5(label.encode()).hexdigest()))
byid={r['profile_id']:r for r in rows}
assert byid[key('noauth')]['next_review_step']=='verify_original_identity_and_missing_auth_separately'
assert byid[key('ambiguous')]['next_review_step']=='resolve_ambiguous_auth_candidates'
assert byid[key('disabled')]['next_review_step']=='resolve_auth_identity_authority_first'
assert byid[key('misplaced')]['next_review_step']=='review_existing_profile_organization_conflict'
for label,field in [('signup','signup_evidence'),('provision','provisioning_evidence'),('invitation','invitation_evidence')]:
 assert byid[key(label)]['next_review_step']=='review_original_records_for_explicit_profile_restore'
 assert byid[key(label)][field][0]['reservation_metadata_matches'] is True
assert all(r['automatic_reconstruction_allowed'] is False for r in rows)
assert 'PRIVATE_' not in raw and 'DO_NOT_RETURN' not in raw
print('Missing profile evidence READ ONLY / privacy / classification PASS')
PY
docker exec -i "$evidence_container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter table organizations drop column owner_id,drop column status;
SQL
{ printf 'begin read only;\n'; cat scripts/sql/missing-profile-recovery-evidence.sql; printf '\nrollback;\n'; } | docker exec -i "$evidence_container" psql -U postgres -At -v ON_ERROR_STOP=1 > "$evidence_output/optional.log"
python3 - "$evidence_output/optional.log" <<'PY'
import json
from pathlib import Path
raw=Path(__import__('sys').argv[1]).read_text()
result=json.loads(next(line for line in raw.splitlines() if line.startswith('{')))
rows=result['missing_or_misplaced_profiles']
assert len(rows)==7
assert all(r['owner_pointer_field_present'] is False and r['organization_status_field_present'] is False for r in rows)
assert all(r['next_review_step']=='resolve_organization_lifecycle_first' for r in rows)
print('Missing optional organization columns PASS')
PY
