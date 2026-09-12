"""Run only against disposable signup fixture: container and database args."""
import subprocess
import sys
import time

container, database = sys.argv[1:]
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At']
subprocess.run(base, input="insert into email_verifications(email,verified_at) values('race@example.test',now());", text=True, capture_output=True, check=True)
claim = "select claim_signup('race@example.test',gen_random_uuid(),'{\"fullName\":\"Race\",\"company\":\"Race\"}','free','version',repeat('a',64));"
a = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
a.stdin.write('begin;' + claim + 'select pg_sleep(3);commit;')
a.stdin.close()
for _ in range(100):
    ready = subprocess.run(base, input="select count(*) from pg_stat_activity where query='select pg_sleep(3);' and wait_event='PgSleep';", text=True, capture_output=True, check=True)
    if ready.stdout.strip() != '0':
        break
    time.sleep(.02)
else:
    raise RuntimeError('Signup claim did not reach the synchronization point')
b = subprocess.run(base, input=claim, text=True, capture_output=True)
a.wait()
if a.returncode != 0:
    raise RuntimeError(a.stderr.read())
if b.returncode == 0 or 'SIGNUP_BUSY' not in b.stderr:
    raise RuntimeError('Concurrent signup claim was not refused: ' + b.stderr)
count = subprocess.run(base, input="select count(*) from app_private.signup_attempts where email='race@example.test';", text=True, capture_output=True, check=True)
if count.stdout.strip() != '1':
    raise RuntimeError('Signup reservation duplicated')
print('Concurrent signup reservation PASS')

# Concurrent guesses must consume separate attempts rather than all writing
# the same stale read+1 value as the former HTTP read/update implementation.
from concurrent.futures import ThreadPoolExecutor
subprocess.run(base, input="insert into email_verifications(email,code_hash,expires_at,signup_grant_hash) values('parallel-guesses@example.test',repeat('b',64),now()+interval '10 minutes',null);", text=True, capture_output=True, check=True)
def guess(_):
    return subprocess.run(base, input="select verify_signup_code('parallel-guesses@example.test',repeat('c',64),repeat('d',64));", text=True, capture_output=True, check=True)
with ThreadPoolExecutor(max_workers=6) as executor:
    list(executor.map(guess, range(6)))
count = subprocess.run(base, input="select attempts from email_verifications where email='parallel-guesses@example.test';", text=True, capture_output=True, check=True)
if count.stdout.strip() != '5':
    raise RuntimeError('Parallel incorrect code guesses lost their attempt accounting')
proof = subprocess.run(base, input="select verify_signup_code('parallel-guesses@example.test',repeat('b',64),repeat('d',64))->>'verified';", text=True, capture_output=True, check=True)
if proof.stdout.strip() != 'false':
    raise RuntimeError('Exhausted verification code was accepted')
print('Concurrent verification attempt accounting PASS')
