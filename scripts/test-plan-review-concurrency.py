#!/usr/bin/env python3
"""Two-session submit/review regression for the isolated plan-review fixture.

Usage: python3 scripts/test-plan-review-concurrency.py CONTAINER DATABASE
Run database/tests/task_plan_review_transaction.sql first. Billing is injected;
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
reviewer = "72000000-0000-0000-0000-000000000004"
task = "72000000-0000-0000-0000-000000000005"

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

def scenario(second_call, expected_error, label):
    sql(f"""
    insert into memberships(organization_id,user_id,user_type,role,status,email) values
      ('{org}','{actor}','developer','developer','active','dev@example.test'),
      ('{org}','{reviewer}','admin','owner','active','owner@example.test');
    insert into projects(id,organization_id,name,assigned_developer_id,created_by,created_by_type,task_plan_status,task_plan_submitted)
      values('{project}','{org}','Concurrent plan','{actor}','{reviewer}','admin','pending',true);
    insert into developer_tasks(id,organization_id,project_id,developer_id,task_title,start_date,end_date)
      values('{task}','{org}','{project}','{actor}','Existing saved task','2026-09-11','2026-09-12');
    """)
    original = sql(f"select to_jsonb(t) from developer_tasks t where id='{task}';")
    first = second = None
    try:
        first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        first.stdin.write(f"set application_name='plan_review_first'; begin; set local role service_role; select commit_task_plan_review('{org}','{project}','{reviewer}','admin','approve');\n")
        first.stdin.flush()
        wait_for("select exists(select 1 from pg_stat_activity where application_name='plan_review_first' and state='idle in transaction');", [first], "uncommitted real review RPC")
        second = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second.stdin.write("set application_name='plan_review_second'; begin; set local role service_role; " + second_call + " commit;\n")
        second.stdin.flush()
        wait_for("select exists(select 1 from pg_stat_activity where application_name='plan_review_second' and wait_event_type='Lock');", [first, second], "competing real RPC lock wait")
        first_out, first_err = first.communicate("commit;\n", timeout=15)
        if first.returncode != 0:
            raise AssertionError(f"Approval RPC failed: {first_out} {first_err}")
        second_out, second_err = second.communicate(timeout=15)
        if second.returncode == 0 or expected_error not in second_err:
            raise AssertionError(f"Competing RPC did not conflict: {second_out} {second_err}")
        result = sql(f"""select task_plan_status||','||task_plan_reviewed_by::text||','||
          (select count(*) from notifications where project_id='{project}')||','||
          (select count(*) from notifications where project_id='{project}' and developer_id='{actor}' and type='task_plan_approved')||','||
          (select count(*) from developer_tasks where project_id='{project}') from projects where id='{project}';""")
        if result != f"approved,{reviewer},1,1,1":
            raise AssertionError(f"Verdict, notice, or task count changed: {result}")
        if sql(f"select to_jsonb(t) from developer_tasks t where id='{task}';") != original:
            raise AssertionError("Original task identity or contents changed")
        print(f"PASS: {label}; observed overlapping lock wait, one approval/notice, saved task unchanged")
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.kill()
                process.communicate(timeout=5)
        sql(f"delete from notifications where project_id='{project}'; delete from developer_tasks where project_id='{project}'; delete from projects where id='{project}'; delete from memberships where organization_id='{org}'; delete from app_private.quota_locks where organization_id='{org}';")

scenario(f"select submit_existing_task_plan('{org}','{project}','{actor}');", "PLAN_CONFLICT:", "review versus existing-plan submit")
scenario(f"select commit_task_plan_review('{org}','{project}','{reviewer}','admin','reject','Competing verdict');", "PLAN_REVIEW_CONFLICT:", "approve versus reject")
