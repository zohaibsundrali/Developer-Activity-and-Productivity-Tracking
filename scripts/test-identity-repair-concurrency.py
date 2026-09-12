"""Two operators cannot repair the same identity twice; disposable fixture DB only."""
import subprocess
import sys
import time

container = sys.argv[1]
database = sys.argv[2] if len(sys.argv) > 2 else 'postgres'
base = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At']
repair = "select public.operator_repair_profile_identity('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000011','developer','99000000-0000-0000-0000-000000000091',true,false,'REPAIR VERIFIED EXISTING IDENTITY','concurrent operator test');"
first = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    first.stdin.write("set application_name='identity-repair-race'; begin; " + repair + " select pg_sleep(2); commit;\n")
    first.stdin.close()
    first.stdin = None
    ready = False
    for _ in range(60):
        state = subprocess.run(base, input="select count(*) from pg_stat_activity where application_name='identity-repair-race' and wait_event='PgSleep';", text=True, capture_output=True, timeout=5, check=True)
        if state.stdout.strip() == '1':
            ready = True
            break
        if first.poll() is not None:
            break
        time.sleep(0.05)
    if not ready:
        raise RuntimeError('First repair did not reach its confirmed transaction hold')
    second = subprocess.run(base, input=repair, text=True, capture_output=True, timeout=10)
    stdout, stderr = first.communicate(timeout=10)
    if first.returncode != 0:
        raise RuntimeError('First repair failed: ' + stderr)
    if second.returncode == 0 or 'identity_already_linked' not in second.stderr:
        raise RuntimeError('Competing repair did not recheck current link: ' + second.stderr)
    count = subprocess.run(base, input="select count(*) from app_private.identity_repair_audit where operator_reference='concurrent operator test';", text=True, capture_output=True, timeout=5, check=True)
    if count.stdout.strip() != '1':
        raise RuntimeError('Concurrent repair produced unexpected audit count')
    print('Concurrent operator identity repair passed: one repair, one refusal, one audit')
finally:
    if first.poll() is None:
        first.terminate()
        first.communicate(timeout=5)
