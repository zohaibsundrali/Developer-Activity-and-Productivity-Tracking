#!/usr/bin/env python3
"""Concurrent caller-authenticated attendance requests against real PostgreSQL."""
import concurrent.futures
import json
import subprocess
import sys
import time

container = sys.argv[1]
database = sys.argv[2] if len(sys.argv) > 2 else 'transactional_attendance_test'
base = ['docker','exec','-i',container,'psql','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1']
auth = "select set_config('request.jwt.claims',timesheet_test_claims('developer'),false); set role authenticated;"

def run(sql):
    p = subprocess.run(base,input=sql,text=True,capture_output=True,timeout=30)
    if p.returncode:
        raise AssertionError(p.stderr)
    return p.stdout.strip()

def request(action,day):
    return json.loads(run(auth + f"select record_attendance('{action}','{day}');").splitlines()[-1])

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    receipts = list(pool.map(lambda _: request('check_in','2026-10-10'), range(4)))
assert sum(not r['unchanged'] for r in receipts) == 1
assert len({r['record']['id'] for r in receipts}) == 1
assert len({r['record']['check_in_at'] for r in receipts}) == 1

first = subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
first.stdin.write("set application_name='attendance_checkin_race'; begin;" + auth + "select record_attendance('check_in','2026-10-09'); select pg_sleep(1.5); commit;")
first.stdin.close()
for _ in range(200):
    ready = run("select count(*) from pg_stat_activity where application_name='attendance_checkin_race' and wait_event='PgSleep';")
    if ready == '1':
        break
    if first.poll() is not None:
        raise AssertionError(first.stderr.read())
    time.sleep(0.05)
else:
    first.kill()
    raise AssertionError('Check-in transaction did not reach synchronization point')
closed = request('check_out','2026-10-09')
first.wait(timeout=30)
assert first.returncode == 0, first.stderr.read()
assert not closed['unchanged'] and closed['record']['check_in_at'] and closed['record']['check_out_at']
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    receipts = list(pool.map(lambda _: request('check_out','2026-10-09'), range(4)))
assert all(r['unchanged'] and r['record'] == closed['record'] for r in receipts)
print('PASS: parallel check-ins create one row; checkout waits for check-in; repeated checkout preserves timestamp')
