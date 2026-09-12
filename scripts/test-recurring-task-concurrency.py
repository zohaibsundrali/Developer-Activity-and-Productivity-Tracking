"""Two cron workers with the same snapshot create one occurrence and notice."""
import json
import subprocess
import sys
import time

container = sys.argv[1]
database = sys.argv[2] if len(sys.argv) > 2 else 'postgres'
base = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At']
spawn = "select public.spawn_recurring_task('99100000-0000-0000-0000-000000000202','{\"freq\":\"monthly\",\"interval\":1}','2024-01-31','2024-03-02');"
first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    first.stdin.write("set application_name='recurring-task-race'; begin; " + spawn + " select pg_sleep(2); commit;\n")
    first.stdin.close()
    first.stdin = None
    ready = False
    for _ in range(60):
        state = subprocess.run(base, input="select count(*) from pg_stat_activity where application_name='recurring-task-race' and wait_event='PgSleep';", text=True, capture_output=True, timeout=5, check=True)
        if state.stdout.strip() == '1':
            ready = True
            break
        if first.poll() is not None:
            break
        time.sleep(0.05)
    if not ready:
        raise RuntimeError('First recurring transaction did not reach its confirmed hold')
    second = subprocess.run(base, input=spawn, text=True, capture_output=True, timeout=10)
    stdout, stderr = first.communicate(timeout=10)
    if first.returncode != 0 or second.returncode != 0:
        raise RuntimeError('Concurrent recurring RPC failed: ' + stderr + second.stderr)
    second_result = json.loads(second.stdout.strip())
    if second_result != {'spawned': False, 'reason': 'template_changed'}:
        raise RuntimeError('Competing worker did not discard its stale snapshot: ' + second.stdout)
    count = subprocess.run(base, input="select count(*) from pm_activity a join developer_tasks t on t.id=(a.meta->>'spawnedTaskId')::uuid join notifications n on n.task_id=t.id where a.entity_id='99100000-0000-0000-0000-000000000202' and a.action='recurring_spawned';", text=True, capture_output=True, timeout=5, check=True)
    if count.stdout.strip() != '1':
        raise RuntimeError('Concurrent recurrence did not produce exactly one child/activity/assignment notice')
    print('Concurrent recurring task passed: one child, activity and assignment notice')
finally:
    if first.poll() is None:
        first.terminate()
        first.communicate(timeout=5)
