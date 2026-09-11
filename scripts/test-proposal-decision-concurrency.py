#!/usr/bin/env python3
"""Real competing proposal RPCs; run proposal_decision_transaction.sql first.
Fixture injects billing, while locking, transactions, project/link/email rows are real.
Usage: python3 scripts/test-proposal-decision-concurrency.py CONTAINER DATABASE
"""
import subprocess
import sys
import time

container, database = sys.argv[1:]
base = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At']
org = '79000000-0000-4000-8000-000000000001'
actor = '79000000-0000-4000-8000-000000000002'
client = '79000000-0000-4000-8000-000000000003'
proposal = '79000000-0000-4000-8000-000000000004'

def sql(statement):
    return subprocess.run(base, input=statement, text=True, capture_output=True, check=True, timeout=15).stdout.strip()

def wait_for(predicate, processes, reason):
    until = time.monotonic() + 30
    while time.monotonic() < until:
        for process in processes:
            if process.poll() is not None:
                out, err = process.communicate()
                raise AssertionError(f'Session ended before {reason}: {out} {err}')
        if sql(predicate) == 't':
            return
        time.sleep(0.05)
    raise AssertionError(f'Timed out waiting for {reason}')

def scenario(first_decision, second_decision, replay):
    sql(f"""insert into organizations values('{org}');
    insert into clients values('{client}','{org}','active','client@example.test');
    insert into memberships(organization_id,user_id,user_type,role,status) values
    ('{org}','{actor}','admin','owner','active'),('{org}','{client}','client','client','active');
    insert into project_proposals(id,organization_id,client_id,title,description) values('{proposal}','{org}','{client}','Concurrent proposal','Scope');""")
    first = second = None
    try:
        first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        first.stdin.write(f"set application_name='proposal_first'; begin; set local role service_role; select decide_project_proposal('{org}','{proposal}','{actor}','admin','{first_decision}','Public reason');\n")
        first.stdin.flush()
        wait_for("select exists(select 1 from pg_stat_activity where application_name='proposal_first' and state='idle in transaction');", [first], 'first uncommitted decision')
        second = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second.stdin.write(f"set application_name='proposal_second'; begin; set local role service_role; select decide_project_proposal('{org}','{proposal}','{actor}','admin','{second_decision}','Public reason'); commit;\n")
        second.stdin.flush()
        wait_for("select exists(select 1 from pg_stat_activity where application_name='proposal_second' and wait_event_type='Lock');", [first, second], 'actual competing transaction lock')
        out, err = first.communicate('commit;\n', timeout=15)
        if first.returncode:
            raise AssertionError(f'First decision failed: {out} {err}')
        out, err = second.communicate(timeout=15)
        if replay:
            if second.returncode or '"replayed": true' not in out:
                raise AssertionError(f'Accepted replay failed: {out} {err}')
        elif second.returncode == 0 or 'PROPOSAL_CONFLICT' not in err:
            raise AssertionError(f'Competing decision did not conflict: {out} {err}')
        result = sql(f"select status||','||(select count(*) from projects)||','||(select count(*) from project_clients)||','||(select count(*) from proposal_decision_emails) from project_proposals where id='{proposal}';")
        count = 1 if first_decision == 'accepted' else 0
        if result != f'{first_decision},{count},{count},1':
            raise AssertionError(f'Duplicate or orphan acceptance: {result}')
        print(f'PASS: {first_decision} versus {second_decision}; observed lock wait, one decision/email intent, no orphan project')
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.kill(); process.communicate(timeout=5)
        sql(f"delete from project_clients; delete from project_proposals; delete from projects; delete from clients; delete from memberships; delete from organizations; delete from app_private.quota_locks;")

scenario('accepted', 'accepted', True)
scenario('rejected', 'accepted', False)
scenario('accepted', 'rejected', False)
