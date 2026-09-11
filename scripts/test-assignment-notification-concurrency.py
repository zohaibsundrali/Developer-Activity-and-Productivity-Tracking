#!/usr/bin/env python3
"""Run after task_assignment_notifications.sql; serialize competing handovers."""
import subprocess
import sys
import time

container, database = sys.argv[1:]
base = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At']
org = '00000000-0000-0000-0000-000000000001'
project = '77000000-0000-0000-0000-000000000101'
task = '78000000-0000-0000-0000-000000000101'
users = ['78000000-0000-0000-0000-00000000000' + str(i) for i in (1, 2, 3)]

def sql(statement):
    return subprocess.run(base, input=statement, text=True, capture_output=True, check=True, timeout=15).stdout.strip()

def wait_for(name, condition, processes):
    until = time.monotonic() + 20
    while time.monotonic() < until:
        for process in processes:
            if process.poll() is not None:
                raise AssertionError(f'Session ended early: {process.communicate()}')
        if sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and {condition});") == 't':
            return
        time.sleep(.05)
    raise AssertionError('Assignment did not reach expected lock state')

sessions = []
try:
    for user in users:
        sql(f"insert into memberships(organization_id,user_id,user_type,email,status,role) values('{org}','{user}','developer','{user}@test.dev','active','developer');")
    sql(f"insert into developer_tasks(id,organization_id,project_id,developer_id,task_title) values('{task}','{org}','{project}','{users[0]}','Assignment concurrency');")
    for index, user in enumerate(users[1:]):
        process = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        sessions.append(process)
        process.stdin.write(f"set application_name='assignment_race_{index}'; begin; update developer_tasks set developer_id='{user}' where id='{task}';\n")
        process.stdin.flush()
        wait_for(f'assignment_race_{index}', "state='idle in transaction'" if index == 0 else "wait_event_type='Lock'", sessions)
    out, err = sessions[0].communicate('commit;\n', timeout=15)
    if sessions[0].returncode:
        raise AssertionError(f'First assignment failed: {out} {err}')
    out, err = sessions[1].communicate('commit;\n', timeout=15)
    if sessions[1].returncode:
        raise AssertionError(f'Second assignment failed: {out} {err}')
    assert sql(f"select developer_id from developer_tasks where id='{task}';") == users[2]
    for user in users[:2]:
        assert sql(f"select count(*) from notifications where developer_id='{user}' and type='task_reassigned_away' and metadata->>'taskTitle'='Assignment concurrency' and task_id is null and project_id is null;") == '1'
    for user in users[1:]:
        assert sql(f"select count(*) from notifications where developer_id='{user}' and type='task_reassigned' and task_id='{task}';") == '1'
    print('PASS: competing assignments serialize; each committed OLD assignee gets exactly one private removal snapshot')
finally:
    for process in sessions:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    sql(f"delete from notifications where task_id='{task}' or metadata->>'taskTitle'='Assignment concurrency'; delete from developer_tasks where id='{task}';")
    for user in users:
        sql(f"delete from memberships where organization_id='{org}' and user_id='{user}';")
