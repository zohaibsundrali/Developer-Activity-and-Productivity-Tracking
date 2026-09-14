"""Concurrent stale previews fail; an identical request returns its saved receipt."""
import json
import subprocess
import sys
import time
container = sys.argv[1]
def command(sql):
    return ['docker','exec',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1','-c',sql]
def run(sql):
    return subprocess.run(command(sql),capture_output=True,text=True,timeout=15)
prefix = "begin; select set_config('request.jwt.claims',github_test_claims(),true); set local role authenticated;"
project = '74000000-0000-0000-0000-000000000104'
probe = run(prefix + f"select github_issue_sync_context('{project}',50)->>'fingerprint'; commit;")
assert probe.returncode == 0, probe.stderr
expected = next(line for line in probe.stdout.splitlines() if len(line) == 32)
source = "github_import_issue(50)||jsonb_build_object('title','Concurrent remote change')"
def sync(request_id):
    return f"select github_sync_test('{request_id}','{expected}',{source},'github','github');"
request_id = 'd2000000-0000-0000-0000-000000000001'
first = subprocess.Popen(command(prefix+sync(request_id)+'select pg_sleep(2); commit;'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
for _ in range(100):
    probe = run("select count(*) from pg_stat_activity where wait_event='PgSleep'")
    if probe.stdout.strip() == '1':
        break
    time.sleep(0.05)
else:
    first.kill()
    raise AssertionError('First sync did not reach its locked phase')
second = run(prefix+sync('d2000000-0000-0000-0000-000000000002')+'commit;')
output,error = first.communicate(timeout=15)
assert first.returncode == 0,error
assert second.returncode != 0 and 'GITHUB_SYNC_STALE' in second.stderr,second.stderr
retry = run(prefix+sync(request_id)+'commit;')
assert retry.returncode == 0,retry.stderr
receipt = next(json.loads(line) for line in retry.stdout.splitlines() if line.startswith('{') and '"unchanged"' in line)
assert receipt['unchanged'] is True and receipt['event']['id'] == request_id
count = run("select count(*) from github_issue_task_syncs where id in ('d2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002')")
assert count.stdout.strip() == '1',count.stdout
print('Concurrent syncs: one commit, one stale preview rejection, identical retry returned saved event.')
