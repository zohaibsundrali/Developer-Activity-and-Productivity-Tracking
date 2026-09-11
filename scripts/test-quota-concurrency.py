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


for isolation in ('READ COMMITTED', 'REPEATABLE READ'):
    org = '00000000-0000-0000-0000-000000000002'
    sql(f"delete from projects where organization_id='{org}';"
        f"insert into projects(organization_id) values ('{org}');")
    first = subprocess.Popen(command, stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"begin; insert into projects(organization_id) values ('{org}');"
                      "select pg_sleep(2); commit;")
    first.stdin.close()
    # Wait for the first write to finish and hold its transaction open. Do not
    # guess that the process has started based on an arbitrary sleep.
    for _ in range(100):
        waiting = sql("select count(*) from pg_stat_activity where datname='quota_test'"
                      " and wait_event='PgSleep';").stdout.strip()
        if waiting == '1':
            break
        time.sleep(0.01)
    else:
        first.kill()
        raise AssertionError('First transaction never reached the concurrency barrier')
    second = sql(f"begin isolation level {isolation}; select count(*) from projects;"
                 f"insert into projects(organization_id) values ('{org}'); commit;", check=False)
    first.wait(timeout=10)
    assert first.returncode == 0, first.stderr.read()
    assert second.returncode != 0, 'Concurrent insert exceeded the quota'
    expected = 'PLAN_LIMIT_REACHED' if isolation == 'READ COMMITTED' else 'could not serialize'
    assert expected in second.stderr, second.stderr
    assert sql(f"select count(*) from projects where organization_id='{org}';").stdout.strip() == '2'
    print(f'PASS: competing inserts at {isolation} cannot exceed the final seat')
