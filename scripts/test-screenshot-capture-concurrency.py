#!/usr/bin/env python3
"""Run only against a disposable database initialized by the screenshot fixture."""
import concurrent.futures
import json
import subprocess
import sys

container, database = sys.argv[1:3]
claims = json.dumps({'sub': '00000000-0000-0000-0000-000000000011', 'session_id': '00000000-0000-0000-0000-000000000022', 'email': 'dev@example.test', 'app_metadata': {'organization_id': '00000000-0000-0000-0000-000000000002', 'app_user_id': '00000000-0000-0000-0000-000000000012', 'user_type': 'developer', 'role': 'developer'}})
cap = '10000000-0000-0000-0000-000000000004'
identity = f"select set_config('request.jwt.claims','{claims}',false);"
def sql(statement):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], input=statement, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

sql(identity + "insert into organization_subscriptions(organization_id,plan_code,status) values ('00000000-0000-0000-0000-000000000002','professional','active'); set role authenticated; select enroll_tracker_device('parallel','test');" + f"insert into storage.objects(bucket_id,name,metadata) values('monitoring',screenshot_test_payload('{cap}')->>'storage_path','{{\"size\":1024}}');")
statement = identity + f"begin; set local role authenticated; select finalize_screenshot_capture('{cap}',screenshot_test_payload('{cap}')); select pg_sleep(0.15); commit;"
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(sql, [statement] * 4))
for result in results:
    receipts = [json.loads(line) for line in result.splitlines() if line.startswith('{') and '"success"' in line]
    assert len(receipts) == 1 and receipts[0]['capture_id'] == cap and receipts[0]['success'] is True
assert sql(f"select count(*) from screenshots where capture_id='{cap}';").strip() == '1'
print('PASS: four concurrent finalizations returned one durable screenshot receipt')
