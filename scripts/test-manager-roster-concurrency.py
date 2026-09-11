#!/usr/bin/env python3
"""Run after typed_project_manager_roster.sql: actual two-session manager races.
Usage: python3 scripts/test-manager-roster-concurrency.py CONTAINER DATABASE
"""
import subprocess
import sys
import time

container, database = sys.argv[1:]
base = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At']
org = '74000000-0000-0000-0000-000000000001'
actor = '74000000-0000-0000-0000-000000000013'
project = '74000000-0000-0000-0000-000000000199'

def sql(statement):
    return subprocess.run(base, input=statement, text=True, capture_output=True, check=True, timeout=15).stdout.strip()

def wait_for(name, condition, processes):
    until = time.monotonic() + 20
    while time.monotonic() < until:
        for process in processes:
            if process.poll() is not None:
                out, err = process.communicate()
                raise AssertionError(f'Unexpected session exit: {out} {err}')
        if sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and {condition});") == 't':
            return
        time.sleep(0.05)
    raise AssertionError(f'Timed out waiting for {name}: {condition}')

def start(name, statement):
    process = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{name}'; begin; {statement}\n")
    process.stdin.flush()
    return process

def finish(process, statement='', failure=None):
    out, err = process.communicate(statement, timeout=15)
    if failure:
        if process.returncode == 0 or failure not in err:
            raise AssertionError(f'Expected {failure}: {out} {err}')
    elif process.returncode != 0:
        raise AssertionError(f'Session failed: {out} {err}')

original_status = sql(f"select status from memberships where organization_id='{org}' and user_id='{actor}' and user_type='admin';")
assignment = f"update projects set manager_id='{actor}',manager_type='admin' where id='{project}';"
deletion = f"delete from project_members where project_id='{project}' and user_id='{actor}' and user_type='admin';"
sessions = []
try:
    sql(f"""update memberships set status='active' where organization_id='{org}' and user_id='{actor}' and user_type='admin';
    insert into projects(id,organization_id,name) values('{project}','{org}','Manager concurrency');
    insert into project_members(organization_id,project_id,user_id,user_type,project_role) values('{org}','{project}','{actor}','admin','developer');""")
    first = start('manager_assignment_first', assignment)
    sessions.append(first)
    wait_for('manager_assignment_first', "state='idle in transaction'", [first])
    second = start('manager_delete_second', deletion + ' commit;')
    sessions.append(second)
    wait_for('manager_delete_second', "wait_event_type='Lock'", [first, second])
    finish(first, 'commit;\n')
    finish(second, failure='Reassign the project manager')
    assert sql(f"select count(*) from projects p join project_members m on m.project_id=p.id and m.user_id=p.manager_id and m.user_type=p.manager_type where p.id='{project}' and m.project_role='manager';") == '1'
    print('PASS: concurrent roster deletion waits and cannot remove newly assigned typed manager')

    sql(f"update projects set manager_id=null,manager_type=null where id='{project}';")
    first = start('manager_delete_first', deletion)
    sessions.append(first)
    wait_for('manager_delete_first', "state='idle in transaction'", [first])
    second = start('manager_assignment_second', assignment + ' commit;')
    sessions.append(second)
    wait_for('manager_assignment_second', "wait_event_type='Lock'", [first, second])
    finish(first, 'commit;\n')
    finish(second)
    assert sql(f"select count(*) from project_members where project_id='{project}' and user_id='{actor}' and user_type='admin' and project_role='manager';") == '1'
    print('PASS: assignment after committed deletion recreates the authoritative typed manager membership')
finally:
    for process in sessions:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    sql(f"delete from projects where id='{project}'; update memberships set status='{original_status}' where organization_id='{org}' and user_id='{actor}' and user_type='admin';")
