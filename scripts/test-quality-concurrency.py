#!/usr/bin/env python3
"""Two-session duplicate-defect regression for the isolated quality fixture.

Usage: python3 scripts/test-quality-concurrency.py CONTAINER DATABASE
Run database/tests/quality_transactions.sql in DATABASE first. The fixture's
billing/quota helpers are injected; this checks the production RPC run/execution
row locks, duplicate verdict, and absence of orphan defects, not quota behavior.
"""
import subprocess
import sys
import time

container, database = sys.argv[1:]
base = ["docker", "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At"]
org = "72000000-0000-0000-0000-000000000001"
actor = "72000000-0000-0000-0000-000000000002"
project = "72000000-0000-0000-0000-000000000003"
case = "72000000-0000-0000-0000-000000000004"
run = "72000000-0000-0000-0000-000000000005"
execution = "72000000-0000-0000-0000-000000000006"

def sql(statement):
    return subprocess.run(base, input=statement, text=True, capture_output=True, check=True, timeout=15).stdout.strip()

def wait_for(predicate, processes, reason):
    until = time.monotonic() + 30
    while time.monotonic() < until:
        for process in processes:
            if process.poll() is not None:
                output, error = process.communicate()
                raise AssertionError(f"Session terminated before {reason}: {output} {error}")
        if sql(predicate) == "t":
            return
        time.sleep(0.05)
    raise AssertionError(f"Timed out waiting for {reason}")

sql(f"""
insert into memberships(organization_id,user_id,user_type,role,status) values('{org}','{actor}','developer','qa','active');
insert into projects(id,organization_id) values('{project}','{org}');
insert into test_cases(id,organization_id,project_id,title) values('{case}','{org}','{project}','Concurrent case');
insert into test_runs(id,organization_id,project_id,name) values('{run}','{org}','{project}','Concurrent run');
insert into test_executions(id,organization_id,run_id,test_case_id,result) values('{execution}','{org}','{run}','{case}','failed');
""")
call = f"select raise_quality_bug('{org}','{actor}','developer','{execution}','Race regression','major','isolated');"
first = second = None
try:
    first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write("set application_name='qa_concurrency_first'; begin; set local role service_role; " + call + "\n")
    first.stdin.flush()
    wait_for("select exists(select 1 from pg_stat_activity where application_name='qa_concurrency_first' and state='idle in transaction');", [first], "first uncommitted successful defect")
    second = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write("set application_name='qa_concurrency_second'; begin; set local role service_role; " + call + " commit;\n")
    second.stdin.flush()
    wait_for("select exists(select 1 from pg_stat_activity where application_name='qa_concurrency_second' and wait_event_type='Lock');", [first, second], "second overlapping request to wait on the row lock")
    # Only commit after observing an actual overlapping blocked request. There
    # are no sleep-based assumptions about process startup or database speed.
    first_out, first_err = first.communicate("commit;\n", timeout=15)
    if first.returncode != 0:
        raise AssertionError(f"First request failed: {first_out} {first_err}")
    second_out, second_err = second.communicate(timeout=15)
    if second.returncode == 0 or "QA_CONFLICT: That result already has a defect linked" not in second_err:
        raise AssertionError(f"Second request did not conflict: {second_out} {second_err}")
    counts = sql(f"select (select count(*) from developer_tasks where project_id='{project}')||','||(select count(*) from test_executions where id='{execution}' and bug_task_id is not null);")
    if counts != "1,1":
        raise AssertionError(f"Duplicate or orphan task after concurrent calls: {counts}")
    print("PASS: overlapping defect requests produced one commit, one QA_CONFLICT, and exactly one linked task")
finally:
    for process in (first, second):
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    sql(f"delete from test_executions where id='{execution}'; delete from test_runs where id='{run}'; delete from test_cases where id='{case}'; delete from developer_tasks where project_id='{project}'; delete from projects where id='{project}'; delete from memberships where organization_id='{org}';")
