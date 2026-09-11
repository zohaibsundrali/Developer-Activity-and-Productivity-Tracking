#!/usr/bin/env python3
"""After organization_deletion_lifecycle.sql: prove start waits for in-flight
Storage/profile writes and captures their committed resources. No providers."""
import subprocess,sys,time
container,database=sys.argv[1:]
base=['docker','exec','-i',container,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At']
def sql(s):return subprocess.run(base,input=s,text=True,capture_output=True,check=True,timeout=15).stdout.strip()
def wait(q,processes):
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  for p in processes:
   if p.poll() is not None:raise AssertionError(p.communicate())
  if sql(q)=='t':return
  time.sleep(.05)
 raise AssertionError('Expected concurrent lock wait')
org='87000000-0000-4000-8000-000000000001';owner='87000000-0000-4000-8000-000000000002';owner_auth='87000000-0000-4000-8000-000000000003';dev='87000000-0000-4000-8000-000000000004';extra='87000000-0000-4000-8000-000000000005';extra_auth='87000000-0000-4000-8000-000000000006'
sql(f"""insert into organizations(id,name) values('{org}','Concurrent deletion');
insert into auth.users values('{owner_auth}',jsonb_build_object('organization_id','{org}','app_user_id','{owner}','user_type','admin','role','owner')),
('{extra_auth}',jsonb_build_object('organization_id','{org}','app_user_id','{extra}','user_type','developer','role','developer'));
insert into memberships(organization_id,user_id,user_type,role,status) values('{org}','{owner}','admin','owner','active');
insert into admin_users values('{owner}','{org}','{owner_auth}');insert into developers(id,organization_id) values('{dev}','{org}');""")
a=b=None
try:
 a=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 a.stdin.write(f"set application_name='org_inventory_writer';begin;insert into storage.objects(bucket_id,name) values('monitoring','{org}/{dev}/inflight.png');insert into developers values('{extra}','{org}','{extra_auth}');\n");a.stdin.flush()
 wait("select exists(select 1 from pg_stat_activity where application_name='org_inventory_writer' and state='idle in transaction');",[a])
 b=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 b.stdin.write(f"set application_name='org_delete_start';set role service_role;select start_organization_deletion('{org}','{owner}','admin','{owner_auth}','Concurrent deletion',repeat('f',64));\n");b.stdin.flush()
 wait("select exists(select 1 from pg_stat_activity where application_name='org_delete_start' and wait_event_type='Lock');",[a,b])
 out,err=a.communicate('commit;\n',timeout=15)
 if a.returncode:raise AssertionError((out,err))
 out,err=b.communicate(timeout=15)
 if b.returncode:raise AssertionError((out,err))
 result=sql(f"select count(*) filter(where kind='storage')||','||count(*) filter(where kind='auth') from app_private.organization_deletion_items where job_id=(select id from app_private.organization_deletions where organization_id='{org}');")
 if result!='1,2':raise AssertionError(f'In-flight resources missed: {result}')
 sql(f"select proposal_denied($q$insert into storage.objects(bucket_id,name) values('monitoring','{org}/{dev}/late.png')$q$,'deletion is in progress');")
 print('PASS: deletion start waited for actual concurrent storage/profile writes; complete inventory captured; late upload refused')
finally:
 for p in (a,b):
  if p is not None and p.poll() is None:p.kill();p.communicate(timeout=5)
