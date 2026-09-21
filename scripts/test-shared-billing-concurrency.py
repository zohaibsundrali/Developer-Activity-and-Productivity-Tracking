#!/usr/bin/env python3
"""Run only against the disposable shared_account_billing.sql fixture."""
import subprocess
import sys
import time

container, database = sys.argv[1:3]
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1']
def sql(query):
    return subprocess.run(base, input=query, text=True, capture_output=True, check=True).stdout.strip()

anchor, child = sql("select b.account_id,b.organization_id from app_private.organization_billing b join organizations o on o.id=b.organization_id where o.name='Shared child'").split('|')
sql(f"delete from projects where organization_id in(select app_private.billing_organizations('{anchor}')); insert into projects(organization_id,name) values('{anchor}','Existing');")
# Both writers compete for the last slot, from different organizations.
a = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
a.stdin.write(f"begin; insert into projects(organization_id,name) values('{anchor}','Concurrent A'); select pg_sleep(1); commit;")
a.stdin.close()
time.sleep(0.25)
b = subprocess.run(base, input=f"insert into projects(organization_id,name) values('{child}','Concurrent B');", text=True, capture_output=True)
a.wait(timeout=15)
assert a.returncode == 0, a.stderr.read()
assert b.returncode != 0 and 'PLAN_LIMIT_REACHED' in b.stderr, b.stderr
assert sql(f"select count(*) from projects where organization_id in(select app_private.billing_organizations('{anchor}'))") == '2'
print('PASS: concurrent writes in two organizations cannot exceed their combined quota')
