#!/usr/bin/env python3
"""Offline regression for the operator batch: Docker required, no hosted access.

Runs the real repair migrations and the exact operator script in a disposable
PostgreSQL 16 container with networking disabled. Nothing calls hosted Auth.
"""
import pathlib,subprocess,time,json,os
root=pathlib.Path(__file__).resolve().parents[1]
name=f'identity-scoped-apply-test-{os.getpid()}'
def run(args,**kwargs):
 return subprocess.run(args,text=True,capture_output=True,**kwargs)
def sql(text,ok=True):
 p=run(['docker','exec','-i',name,'psql','-X','-At','-U','postgres','-v','ON_ERROR_STOP=1'],input=text)
 if ok and p.returncode: raise RuntimeError(p.stderr)
 return p
apply=(root/'scripts/sql/identity-repair-apply.sql').read_text()
cte=apply[apply.index('with candidates('):apply.index(', repaired as materialized')]
setup=cte+''' select json_agg(json_build_array(org_id,profile_id,auth_id)) from candidates;'''
try:
 p=run(['docker','run','--rm','-d','--name',name,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine'])
 if p.returncode: raise RuntimeError(p.stderr)
 for _ in range(150):
  logs=run(['docker','logs',name])
  if 'PostgreSQL init process complete' in logs.stdout and run(['docker','exec',name,'pg_isready','-U','postgres']).returncode==0: break
  time.sleep(.2)
 fixture=run(['python3','scripts/expand-sql-fixture.py','database/tests/operator_identity_repair.sql'],cwd=root)
 if fixture.returncode: raise RuntimeError(fixture.stderr)
 sql(fixture.stdout)
 rows=json.loads(sql(setup).stdout)
 assert len(rows)==11
 for i,(org,profile,auth) in enumerate(rows):
  email=f'scoped-offline-{i}@example.test'
  sql(f"""insert into organizations(id,name) values('{org}','Offline scoped fixture') on conflict(id) do nothing;
insert into developers(id,organization_id,email,status) values('{profile}','{org}','{email}','active');
insert into memberships(organization_id,user_id,user_type,role,status,email) values('{org}','{profile}','developer','developer','active','{email}');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values('{auth}','{email}',now(),jsonb_build_object('organization_id','{org}','app_user_id','{profile}','user_type','developer','role','developer'));""")
 before=sql('select count(*) from app_private.identity_repair_audit;').stdout.strip()
 last=rows[-1][1]
 sql(f"update developers set status='suspended' where id='{last}';")
 failed=sql(apply,False)
 assert failed.returncode!=0 and 'profile_inactive' in failed.stderr,failed.stderr
 count_sql=cte+' select count(*) from candidates c join developers d on d.id=c.profile_id where d.auth_user_id is not null;'
 assert sql(count_sql).stdout.strip()=='0'
 assert sql('select count(*) from app_private.identity_repair_audit;').stdout.strip()==before
 print('PASS: one ineligible account rolls back all links and audits')
 sql(f"update developers set status='active' where id='{last}';")
 result=sql(apply).stdout.strip().split('|',1)
 assert result[0]=='11' and all(x['applied'] and x['auditId'] for x in json.loads(result[1]))
 assert sql(count_sql).stdout.strip()=='11'
 print('PASS: exact published candidate list applies 11 verified links')
 replay=sql(apply,False)
 assert replay.returncode!=0 and 'identity_already_linked' in replay.stderr
 assert int(sql('select count(*) from app_private.identity_repair_audit;').stdout.strip())==int(before)+11
 print('PASS: replay refused without duplicate audits')
finally:
 run(['docker','stop',name])
