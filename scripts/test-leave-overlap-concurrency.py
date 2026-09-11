"""Run only against a disposable fixture database: container and database args."""
import subprocess, sys, time
container, database = sys.argv[1:]
base = ['docker','exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At']
insert = "insert into leave_requests(organization_id,user_id,user_type,leave_type_id,start_date,end_date,days) select '91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000011','developer',id,'2027-02-04','2027-02-04',1 from leave_types limit 1;"
a = subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
a.stdin.write('begin;'+insert+'select pg_sleep(3);commit;');a.stdin.close()
# Wait until the first transaction has reached its sleep with the typed lock held.
for _ in range(50):
    ready = subprocess.run(base,input="select count(*) from pg_stat_activity where query = 'select pg_sleep(3);' and wait_event='PgSleep';",text=True,capture_output=True,check=True)
    if ready.stdout.strip() != '0': break
    time.sleep(.02)
else: raise RuntimeError('First transaction did not acquire its lock')
b = subprocess.run(base,input=insert,text=True,capture_output=True)
a.wait()
if a.returncode != 0: raise RuntimeError(a.stderr.read())
if b.returncode == 0 or 'Overlapping leave' not in b.stderr: raise RuntimeError('Concurrent overlapping leave was not refused: '+b.stderr)
print('Concurrent typed overlap prevention PASS')
