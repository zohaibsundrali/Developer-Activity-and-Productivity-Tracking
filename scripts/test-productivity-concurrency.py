#!/usr/bin/env python3
"""Actual review/recalculation serialization and downgrade while awaiting org lock."""
import json
import subprocess
import sys
import time
container = sys.argv[1]
database = sys.argv[2] if len(sys.argv) > 2 else 'canonical_productivity_review_test'
base = ['docker','exec','-i',container,'psql','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1']
org='74000000-0000-0000-0000-000000000001'
dev='74000000-0000-0000-0000-000000000011'
manager='74000000-0000-0000-0000-000000000012'
project='74000000-0000-0000-0000-000000000102'
claims=json.dumps({'org':org,'user':dev,'type':'admin','sub':dev,'app_metadata':{'user_type':'admin'}})
auth=f"select set_config('request.jwt.claims','{claims}',false);set role authenticated;"
recalc=auth+f"select recalculate_productivity('{dev}','{project}');"

def run(sql,ok=True):
    result=subprocess.run(base,input=sql,text=True,capture_output=True,timeout=30)
    if ok and result.returncode:raise AssertionError(result.stderr)
    return result

def start(sql):
    proc=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write("set application_name='productivity_race_first';begin;"+sql+"select pg_sleep(1.5);commit;")
    proc.stdin.close()
    for _ in range(200):
        if run("select count(*) from pg_stat_activity where application_name='productivity_race_first' and wait_event='PgSleep';").stdout.strip()=='1':return proc
        if proc.poll() is not None:raise AssertionError(proc.stderr.read())
        time.sleep(.05)
    proc.kill();raise AssertionError('No synchronization point')

def finish(proc):
    proc.wait(timeout=30)
    if proc.returncode:raise AssertionError(proc.stderr.read())

def review(index):
    task=f'99900000-0000-0000-0000-{index:012d}'
    proof=f'99910000-0000-0000-0000-{index:012d}'
    run(f"insert into developer_tasks(id,organization_id,project_id,developer_id,status,task_title,end_date) values('{task}','{org}','{project}','{dev}','awaiting_approval','Concurrency proof','2026-09-15');insert into task_submissions(id,organization_id,task_id,project_id,developer_id,submitted_at) values('{proof}','{org}','{task}','{project}','{dev}','2026-09-14T10:00Z');")
    return f"set role service_role;select commit_task_review('{org}','{manager}','developer','manager@example.test','{task}','{proof}','approve',null,null);"

def assert_canonical():
    result=run(f"select m.total_tasks=t.total and m.completed_on_time=t.timely and m.completed_late=t.late from productivity_metrics m cross join(select count(*) total,count(*) filter(where status='completed' and is_on_time=true) timely,count(*) filter(where status='completed' and is_on_time=false) late from developer_tasks where organization_id='{org}' and project_id='{project}' and developer_id='{dev}') t where m.organization_id='{org}' and m.project_id='{project}' and m.developer_id='{dev}';")
    assert result.stdout.strip()=='t',result.stdout

review1=review(1)
first=start(recalc)
run(review1);finish(first);assert_canonical()
review2=review(2)
first=start(review2)
run(recalc);finish(first);assert_canonical()
first=start(f"select app_private.lock_quota('{org}');update productivity_test_plan set paid=false;")
refused=run(recalc,ok=False);finish(first)
assert refused.returncode and 'PRODUCTIVITY_PLAN_REQUIRED' in refused.stderr,refused.stderr
run('update productivity_test_plan set paid=true;')
print('PASS: actual manager review/recalculation serialize both ways; downgrade while waiting rejects recalculation')
