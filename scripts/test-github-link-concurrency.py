"""Two managers cannot silently overwrite the same repository-link version."""
import subprocess
import sys
import time

container = sys.argv[1]
prefix = "begin; select set_config('request.jwt.claims',github_test_claims(),true); set local role authenticated;"
def request(number):
    return f"select save_project_github('74000000-0000-0000-0000-000000000104',3,{number},'octocat','Repo{number}');"
def command(sql):
    return ['docker', 'exec', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]
first = subprocess.Popen(command(prefix + request(300) + 'select pg_sleep(2); commit;'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
for _ in range(100):
    probe = subprocess.run(command("select count(*) from pg_stat_activity where wait_event='PgSleep'"), capture_output=True, text=True, check=True)
    if probe.stdout.strip() == '1':
        break
    time.sleep(0.05)
else:
    first.kill()
    raise AssertionError('First shift transaction did not reach its locked phase')
second = subprocess.run(command(prefix + request(301) + 'commit;'), capture_output=True, text=True, timeout=15)
_, error = first.communicate(timeout=15)
assert first.returncode == 0, error
assert second.returncode != 0 and 'GITHUB_LINK_STALE' in second.stderr, second.stderr
print('Concurrent stale repository update rejected after the first link committed.')
