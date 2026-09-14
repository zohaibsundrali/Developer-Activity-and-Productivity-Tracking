"""Two concurrent imports must commit a single task and source mapping."""
import json
import subprocess
import sys
import time
container = sys.argv[1]
def command(sql):
    return ['docker','exec',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1','-c',sql]
prefix = "begin; select set_config('request.jwt.claims',github_test_claims(),true); set local role authenticated;"
first = subprocess.Popen(command(prefix + 'select github_import_test(42); select pg_sleep(2); commit;'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
for _ in range(100):
    probe = subprocess.run(command("select count(*) from pg_stat_activity where wait_event='PgSleep'"),capture_output=True,text=True,check=True)
    if probe.stdout.strip() == '1':
        break
    time.sleep(0.05)
else:
    first.kill()
    raise AssertionError('First import did not reach its locked phase')
second = subprocess.run(command(prefix + 'select github_import_test(42); commit;'),capture_output=True,text=True,timeout=15)
output,error = first.communicate(timeout=15)
assert first.returncode == 0,error
assert second.returncode == 0,second.stderr
def receipt(output):
    return next(json.loads(line) for line in output.splitlines() if line.startswith('{') and '"unchanged"' in line)
a,b = receipt(output),receipt(second.stdout)
assert a['unchanged'] is False and b['unchanged'] is True
assert a['task']['id'] == b['task']['id']
count = subprocess.run(command('select count(*) from github_issue_task_imports i join developer_tasks t on t.id=i.task_id where i.issue_number=42'),capture_output=True,text=True,check=True)
assert count.stdout.strip() == '1',count.stdout
print('Concurrent issue imports committed one task; the second returned its existing receipt.')
