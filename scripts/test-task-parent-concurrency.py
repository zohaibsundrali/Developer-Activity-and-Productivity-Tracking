#!/usr/bin/env python3
"""Two-session parent-cycle regression for the isolated task relationship fixture.

Usage: python3 scripts/test-task-parent-concurrency.py CONTAINER DATABASE
Run task_relationship_integrity.sql first. Exercises actual parent trigger and
physical organization lock with two overlapping authenticated updates.
"""
import subprocess
import sys
import time

container, database = sys.argv[1:]
base = ["docker", "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At"]
org = "73000000-0000-0000-0000-000000000001"
actor = "73000000-0000-0000-0000-000000000002"
project = "73000000-0000-0000-0000-000000000003"
task_a = "73000000-0000-0000-0000-000000000004"
task_b = "73000000-0000-0000-0000-000000000005"

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
insert into memberships(organization_id,user_id,user_type,role,status) values('{org}','{actor}','admin','owner','active');
insert into projects(id,organization_id) values('{project}','{org}');
insert into developer_tasks(id,organization_id,project_id) values('{task_a}','{org}','{project}'),('{task_b}','{org}','{project}');
""")
login = f"set local role authenticated; select set_config('request.jwt.claims', '{{\"org\":\"{org}\",\"user\":\"{actor}\",\"type\":\"admin\",\"app_metadata\":{{\"user_type\":\"admin\"}}}}',true); "
first_call = f"update developer_tasks set parent_task_id='{task_b}' where id='{task_a}';"
second_call = f"update developer_tasks set parent_task_id='{task_a}' where id='{task_b}';"
first = second = None
try:
    first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write("set application_name='parent_concurrency_first'; begin; " + login + first_call + "\n")
    first.stdin.flush()
    wait_for("select exists(select 1 from pg_stat_activity where application_name='parent_concurrency_first' and state='idle in transaction');", [first], "first uncommitted parent assignment")
    second = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write("set application_name='parent_concurrency_second'; begin; " + login + second_call + " commit;\n")
    second.stdin.flush()
    wait_for("select exists(select 1 from pg_stat_activity where application_name='parent_concurrency_second' and wait_event_type='Lock');", [first, second], "second overlapping request to wait on the row lock")
    # Only commit after observing an actual overlapping blocked request. There
    # are no sleep-based assumptions about process startup or database speed.
    first_out, first_err = first.communicate("commit;\n", timeout=15)
    if first.returncode != 0:
        raise AssertionError(f"First request failed: {first_out} {first_err}")
    second_out, second_err = second.communicate(timeout=15)
    if second.returncode == 0 or "Task parent hierarchy cannot contain cycles" not in second_err:
        raise AssertionError(f"Second request did not conflict: {second_out} {second_err}")
    counts = sql(f"select count(*) from developer_tasks where project_id='{project}' and parent_task_id is not null;")
    if counts != "1":
        raise AssertionError(f"Expected one parent link after concurrent calls: {counts}")
    print("PASS: overlapping parent edits committed one link and refused the cycle")
finally:
    for process in (first, second):
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    sql(f"delete from projects where id='{project}'; delete from memberships where organization_id='{org}'; delete from app_private.quota_locks where organization_id='{org}';")
