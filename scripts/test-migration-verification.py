#!/usr/bin/env python3
"""Offline catalog regression. Requires an EMPTY disposable PostgreSQL database.
Usage: python3 scripts/test-migration-verification.py <docker-container> <database>
The caller owns container creation/removal. Never target a production database.
"""
import csv
import hashlib
import io
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/sql/production-migration-verification.sql'
container, database = sys.argv[1:]


def sql(source):
    return subprocess.run(
        ['docker', 'exec', '-i', container, 'psql', '-Xq', '--csv', '-U', 'postgres',
         '-d', database, '-v', 'ON_ERROR_STOP=1'],
        input=source, text=True, check=True, capture_output=True,
    ).stdout


def inspect():
    rows = list(csv.DictReader(io.StringIO(sql(SCRIPT.read_text()))))
    summaries = {row['migration']: row for row in rows if row['check_type'] == 'SUMMARY'}
    assert len(summaries) == 7, rows
    return summaries, rows


# Refuse an occupied fixture database; this harness intentionally creates/damages objects.
assert sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
           "where n.nspname not in ('pg_catalog','information_schema') "
           "and n.nspname not like 'pg_toast%' and c.relkind in ('r','p');").strip() == 'count\n0'
source = SCRIPT.read_text()
manifest = re.findall(r'^-- source-sha256 (\S+) ([0-9a-f]{64})$', source, re.M)
assert len(manifest) == 7
for filename, fingerprint in manifest:
    assert hashlib.sha256((ROOT / 'supabase/migrations' / filename).read_bytes()).hexdigest() == fingerprint, filename
summaries, rows = inspect()
assert all(row['status'] == 'REVIEW_REQUIRED' for row in summaries.values())
assert all(row['status'] == 'MISSING' for row in rows if row['check_type'] != 'SUMMARY')
sql((ROOT / 'database/tests/migration_verification_fixture.sql').read_text())
for index, (filename, _) in enumerate(manifest):
    sql((ROOT / 'supabase/migrations' / filename).read_text())
    if index == 1:
        summaries, _ = inspect()
        assert sum(row['status'] == 'CATALOG_CHECKS_MATCH' for row in summaries.values()) == 2
summaries, rows = inspect()
assert len(rows) == 7 and all(row['status'] == 'CATALOG_CHECKS_MATCH' for row in summaries.values()), rows
sql('''grant execute on function public.spawn_recurring_task(uuid,jsonb,date,date) to authenticated;
alter table public.organizations disable trigger aaa_completed_signup_cleanup;
alter function public.auth_org() security invoker;
drop index app_private.signup_pending_email;
''')
_, rows = inspect()
failures = {row['object']: row['status'] for row in rows if row['check_type'] != 'SUMMARY'}
assert failures == {
    'public.spawn_recurring_task(uuid,jsonb,date,date)': 'DRIFT',
    'public.organizations.aaa_completed_signup_cleanup': 'DRIFT',
    'public.auth_org()': 'DRIFT',
    'app_private.signup_pending_email': 'MISSING',
}, failures
print('PASS: seven source fingerprints; absent/partial/complete schemas; four injected catalog regressions')
