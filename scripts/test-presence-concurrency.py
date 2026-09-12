#!/usr/bin/env python3
"""Concurrent presence fencing against the isolated tracker_device_presence fixture."""
import concurrent.futures
import json
import subprocess
import sys
import uuid

container, database = sys.argv[1:3]


def run(statement):
    return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database,
                           '-v', 'ON_ERROR_STOP=1', '-At'], input=statement, text=True,
                          capture_output=True, timeout=30)


def sql(statement):
    result = run(statement)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


identity = "select set_config('request.jwt.claims',presence_claims(),false);begin;set local role authenticated;"


def race(statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(run, [identity + text + ';select pg_sleep(0.1);commit;' for text in statements]))


sql("update memberships set status='active' where user_id='76000000-0000-0000-0000-000000000011' and user_type='developer';"
    "insert into auth.sessions values('81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001') on conflict do nothing;"
    "update tracker_devices set revoked_at=null,expires_at=now()+interval '1 day' where session_id='81000000-0000-0000-0000-000000000001';"
    "delete from tracker_device_presence where device_id=(select id from tracker_devices where session_id='81000000-0000-0000-0000-000000000001');")
nonce = str(uuid.uuid4())
results = race([f"select start_tracker_presence_stream(null,'{nonce}','tracking')"] * 4)
assert all(result.returncode == 0 for result in results), [r.stderr for r in results]
receipts = [json.loads(next(line for line in r.stdout.splitlines() if line.startswith('{') and '"epoch"' in line)) for r in results]
assert all(row == receipts[0] for row in receipts), 'Idempotent concurrent initialization altered receipt'
epoch = receipts[0]['epoch']

results = race([f"select start_tracker_presence_stream('{epoch}','{uuid.uuid4()}','paused')" for _ in range(4)])
assert sum(r.returncode == 0 for r in results) == 1, 'Multiple competing streams acquired one epoch'
assert all(r.returncode == 0 or 'PRESENCE_STREAM_STALE' in r.stderr for r in results)
current = sql("select epoch from tracker_device_presence where device_id=(select id from tracker_devices where session_id='81000000-0000-0000-0000-000000000001');")

results = race([f"select heartbeat_tracker_presence('{current}',{sequence},'{state}')" for sequence, state in [(1, 'tracking'), (4, 'paused'), (3, 'idle'), (2, 'tracking')]])
assert any(r.returncode == 0 for r in results)
assert all(r.returncode == 0 or 'PRESENCE_SEQUENCE_STALE' in r.stderr for r in results)
assert sql("select sequence||':'||state from tracker_device_presence where device_id=(select id from tracker_devices where session_id='81000000-0000-0000-0000-000000000001');") == '4:paused', 'Lower sequence overwrote newest state'
print('PASS: concurrent presence initialization is idempotent; competing streams and older heartbeats are fenced')
