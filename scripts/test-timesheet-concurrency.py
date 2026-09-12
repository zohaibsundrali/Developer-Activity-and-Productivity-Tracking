#!/usr/bin/env python3
"""Real PostgreSQL submission/log-update serialization, both transaction orders."""
import subprocess
import sys
import time

container = sys.argv[1]
database = sys.argv[2] if len(sys.argv) > 2 else 'transactional_timesheet_review_test'
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1']
auth = "select set_config('request.jwt.claims',timesheet_test_claims('developer'),false); set role authenticated;"

def run(sql, ok=True):
    result = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=30)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result

def start(sql):
    process = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write("set application_name='timesheet_concurrency_first'; begin; " + auth + sql + '; select pg_sleep(1.5); commit;')
    process.stdin.close()
    for _ in range(200):
        if run("select count(*) from pg_stat_activity where application_name='timesheet_concurrency_first' and wait_event='PgSleep';").stdout.strip() == '1':
            return process
        if process.poll() is not None:
            raise AssertionError(process.stderr.read())
        time.sleep(0.05)
    process.kill()
    raise AssertionError('First transaction did not reach synchronization point')

def finish(process):
    process.wait(timeout=30)
    if process.returncode:
        raise AssertionError(process.stderr.read())

first = start("select submit_timesheet_week('2026-09-21')")
second = run(auth + "update task_time_logs set seconds=7200 where started_at='2026-09-21T10:00Z';", ok=False)
finish(first)
assert second.returncode and 'TIMESHEET_WEEK_LOCKED' in second.stderr, second.stderr
assert run("select total_seconds from timesheets where week_start='2026-09-21' and user_type='developer';").stdout.strip() == '3600'
run(auth + "insert into task_time_logs(organization_id,developer_id,started_at,ended_at,seconds) values(auth_org(),auth_app_user_id(),'2026-09-28T10:00Z','2026-09-28T11:00Z',3600);")
first = start("update task_time_logs set seconds=7200 where started_at='2026-09-28T10:00Z'")
second = run(auth + "select submit_timesheet_week('2026-09-28');")
finish(first)
assert run("select total_seconds from timesheets where week_start='2026-09-28' and user_type='developer';").stdout.strip() == '7200'
print('PASS: submit-first rejects late edits; edit-first submission includes committed total')
