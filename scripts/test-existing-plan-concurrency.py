#!/usr/bin/env python3
"""Two-session submit/review regression for the isolated existing-plan fixture.

Usage: python3 scripts/test-existing-plan-concurrency.py CONTAINER DATABASE
Run database/tests/existing_plan_submission.sql first. Billing is injected;
this test observes real PostgreSQL project locks and committed state rechecks.
"""
import subprocess
import sys
import time

container, database = sys.argv[1:]
base = ["docker", "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At"]
org = "72000000-0000-0000-0000-000000000001"
actor = "72000000-0000-0000-0000-000000000002"
project = "72000000-0000-0000-0000-000000000003"

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
insert into memberships(organization_id,user_id,user_type,role,status) values('{org}','{actor}','developer','developer','active');
insert into projects(id,organization_id,assigned_developer_id,task_plan_status) values('{project}','{org}','{actor}','draft');
insert into developer_tasks(organization_id,project_id,developer_id,task_title,start_date,end_date) values('{org}','{project}','{actor}','Existing saved task','2026-09-11','2026-09-12');
""")
call = f"select submit_existing_task_plan('{org}','{project}','{actor}');"
first = second = None
try:
    first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"set application_name='plan_review_first'; begin; update projects set task_plan_status='approved' where id='{project}';\n")
    first.stdin.flush()
    wait_for("select exists(select 1 from pg_stat_activity where application_name='plan_review_first' and state='idle in transaction');", [first], "uncommitted approval")
    second = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write("set application_name='plan_submit_second'; begin; set local role service_role; " + call + " commit;\n")
    second.stdin.flush()
    wait_for("select exists(select 1 from pg_stat_activity where application_name='plan_submit_second' and wait_event_type='Lock');", [first, second], "submission waiting on approval lock")
    first_out, first_err = first.communicate("commit;\n", timeout=15)
    if first.returncode != 0:
        raise AssertionError(f"Approval failed: {first_out} {first_err}")
    second_out, second_err = second.communicate(timeout=15)
    if second.returncode == 0 or "PLAN_CONFLICT:" not in second_err:
        raise AssertionError(f"Submission did not conflict: {second_out} {second_err}")
    counts = sql(f"select task_plan_status||','||(select count(*) from developer_tasks where project_id='{project}') from projects where id='{project}';")
    if counts != "approved,1":
        raise AssertionError(f"Approval or saved task overwritten: {counts}")
    print("PASS: overlapping approval/submission preserved approved state and saved task; submission returned PLAN_CONFLICT")
finally:
    for process in (first, second):
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    sql(f"delete from developer_tasks where project_id='{project}'; delete from projects where id='{project}'; delete from memberships where organization_id='{org}';")
