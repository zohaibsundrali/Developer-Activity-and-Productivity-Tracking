#!/usr/bin/env python3
"""Concurrency regression for an isolated activity_aggregate_receipts fixture."""
import concurrent.futures
import json
import subprocess
import sys
container, database = sys.argv[1:3]
claims = json.dumps({'sub':'00000000-0000-0000-0000-000000000032','session_id':'00000000-0000-0000-0000-000000000022','email':'dev@example.test','app_metadata':{'organization_id':'00000000-0000-0000-0000-000000000002','app_user_id':'00000000-0000-0000-0000-000000000012','user_type':'developer','role':'developer'}})
identity = f"select set_config('request.jwt.claims','{claims}',false);"
def sql(statement):
    result = subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],input=statement,text=True,capture_output=True,timeout=25)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout
statement=identity+"begin; set local role authenticated; select ingest_activity_aggregate('app',activity_test_payload('app',180),3); select pg_sleep(0.15); commit;"
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results=list(pool.map(sql,[statement]*4))
for result in results:
    receipts=[json.loads(line) for line in result.splitlines() if line.startswith('{') and '"revision"' in line]
    assert len(receipts)==1 and receipts[0]['revision']==3 and receipts[0]['kind']=='app'
assert sql("select count(*) from app_usage where session_id='70000000-0000-0000-0000-000000000001' and app_name_raw='code';").strip()=='1'
assert sql("select duration_seconds=180 and ingest_revision=3 from app_usage where app_name_raw='code';").strip()=='t'
# A later stale delivery cannot overwrite the concurrently accepted version.
sql(identity+"set role authenticated; select expect_rejected('select ingest_activity_aggregate(''app'',activity_test_payload(''app'',120),2)','ACTIVITY_REVISION_STALE');")
print('PASS: four concurrent activity retries produced one aggregate; stale revision refused')
