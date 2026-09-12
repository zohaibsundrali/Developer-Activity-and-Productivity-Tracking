#!/usr/bin/env python3
"""Run only against the isolated input_capture_receipts SQL fixture."""
import concurrent.futures
import json
import subprocess
import sys

container, database = sys.argv[1:3]
claims = {'sub':'00000000-0000-0000-0000-000000000032','session_id':'00000000-0000-0000-0000-000000000022','email':'dev@example.test','app_metadata':{'organization_id':'00000000-0000-0000-0000-000000000002','app_user_id':'00000000-0000-0000-0000-000000000012','user_type':'developer','role':'developer'}}
payload = dict(session_id='70000000-0000-0000-0000-000000000001', organization_id=claims['app_metadata']['organization_id'], developer_id=claims['app_metadata']['app_user_id'], user_email='dev@example.test', activity_score=50, keyboard_activity_percentage=50, active_time_minutes=0.5, idle_time_minutes=0.5, total_time_minutes=1, total_keys=10, unique_keys=3, words_per_minute=4, per_minute_summary=[], tracked_at='2026-09-12T09:00:00Z')
capture_id='80000000-0000-0000-0000-000000000001'
def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'"
def sql(statement):
    result=subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],input=statement,text=True,capture_output=True,timeout=25)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout
identity="select set_config('request.jwt.claims',"+literal(claims)+",false);"
statement=identity+"begin; set local role authenticated; select ingest_input_capture('keyboard','"+capture_id+"',"+literal(payload)+"::jsonb); select pg_sleep(0.1); commit;"
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results=list(pool.map(sql,[statement]*4))
for result in results:
    receipts=[json.loads(line) for line in result.splitlines() if line.startswith('{') and '"capture_id"' in line]
    assert len(receipts)==1 and receipts[0]['success'] is True and receipts[0]['capture_id']==capture_id
assert sql("select count(*) from keyboard_stats where capture_id='"+capture_id+"';").strip()=='1'
print('PASS: four concurrent input retries returned one durable keyboard capture')
