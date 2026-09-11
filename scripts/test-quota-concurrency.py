"""Exercise actual overlapping transactions in the isolated audit container."""
import subprocess
import sys
import time

container = sys.argv[1]
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres',
           '-d', 'quota_test', '-v', 'ON_ERROR_STOP=1', '-At']


def sql(statement, check=True):
    return subprocess.run(command, input=statement, text=True,
                          capture_output=True, check=check)


def wait_for(predicate, process, label):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f'{label} exited before its barrier: {process.stderr.read()}')
        if sql('select count(*) from pg_stat_activity where ' + predicate).stdout.strip() == '1':
            return
        time.sleep(0.02)
    raise AssertionError(f'{label} never reached its concurrency barrier')


for isolation in ('READ COMMITTED', 'REPEATABLE READ'):
    org = '00000000-0000-0000-0000-000000000002'
    sql(f"delete from projects where organization_id='{org}';"
        f"insert into projects(organization_id) values ('{org}');")
    first = subprocess.Popen(command, stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second = None
    try:
        # Keep the first transaction open until the SECOND is observably waiting
        # on its lock. A fixed pg_sleep can elapse while docker starts process 2,
        # producing a sequential test that falsely expects a serialization error.
        first.stdin.write("set application_name='quota_first'; begin; "
                          f"insert into projects(organization_id) values ('{org}');\n")
        first.stdin.flush()
        wait_for("application_name='quota_first' and state='idle in transaction'",
                 first, 'First transaction')
        second = subprocess.Popen(command, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second.stdin.write("set application_name='quota_second'; "
                           f"begin isolation level {isolation}; select count(*) from projects; "
                           f"insert into projects(organization_id) values ('{org}'); commit;\n")
        second.stdin.close()
        second.stdin = None
        wait_for("application_name='quota_second' and wait_event_type='Lock'",
                 second, 'Second transaction')
        first.stdin.write('commit;\n')
        first.stdin.close()
        first.stdin = None
        _, first_error = first.communicate(timeout=20)
        _, second_error = second.communicate(timeout=20)
        assert first.returncode == 0, first_error
        assert second.returncode != 0, 'Concurrent insert exceeded the quota'
        expected = 'PLAN_LIMIT_REACHED' if isolation == 'READ COMMITTED' else 'could not serialize'
        assert expected in second_error, second_error
        assert sql(f"select count(*) from projects where organization_id='{org}';").stdout.strip() == '2'
        print(f'PASS: competing inserts at {isolation} cannot exceed the final seat')
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
