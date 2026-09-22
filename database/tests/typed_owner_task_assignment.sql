-- Run against the isolated full-schema fixture with synthetic IDs from the QA seed.
begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if;end $$;
create function pg_temp.expect_denied(statement text,label text) returns void language plpgsql as $$
begin
 begin execute statement; exception when insufficient_privilege or check_violation then return; end;
 raise exception 'EXPECTED DENIAL: %',label;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"90000000-0000-0000-0000-000000000001","app_metadata":{"organization_id":"10000000-0000-0000-0000-000000000001","app_user_id":"20000000-0000-0000-0000-000000000001","user_type":"admin","role":"owner"}}',true);
insert into developer_tasks(id,organization_id,project_id,task_title,status,start_date,end_date,assignee_admin_id) values
('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Owner task','pending',current_date,current_date+7,'20000000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select count(*)=1 from developer_tasks where assignee_admin_id=auth_app_user_id()),'Owner self assignment');
reset role;
insert into user_permissions(membership_id,permission_key,allowed)
 select id,k,false from memberships cross join unnest(array['task.view_all','task.review']) k
 where user_id='20000000-0000-0000-0000-000000000001' and user_type='admin';
set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from developer_tasks),'Owner own access does not depend on management visibility');
reset role;
insert into user_permissions(membership_id,permission_key,allowed)
 select id,'task.view_own',false from memberships where user_id='20000000-0000-0000-0000-000000000001' and user_type='admin';
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from developer_tasks),'Explicit own-read denial remains authoritative');
reset role;
delete from user_permissions;
set local role authenticated;
select pg_temp.assert_true(public.auth_typed_task_proof('submissions/20000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/proof.txt',true),'Owner proof upload');
select pg_temp.expect_denied($q$update developer_tasks set assignee_admin_id='20000000-0000-0000-0000-000000000003' where id='50000000-0000-0000-0000-000000000001'$q$,'Cross organization assignee');
reset role;
update memberships set status='suspended' where user_id='30000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.expect_denied($q$update developer_tasks set developer_id='30000000-0000-0000-0000-000000000002',assignee_admin_id=null where id='50000000-0000-0000-0000-000000000001'$q$,'Suspended member assignment');
reset role;
update memberships set status='active' where user_id='30000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.expect_denied($q$update developer_tasks set developer_id='30000000-0000-0000-0000-000000000001' where id='50000000-0000-0000-0000-000000000001'$q$,'Dual assignee');
update developer_tasks set developer_id='30000000-0000-0000-0000-000000000001',assignee_admin_id=null where id='50000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select count(*)=0 from developer_tasks where assignee_admin_id=auth_app_user_id()),'Delegation leaves Owner My Work');
select pg_temp.assert_true((select count(*)=1 from developer_tasks),'Owner retains management visibility');
select set_config('request.jwt.claims','{"sub":"90000000-0000-0000-0000-000000000002","app_metadata":{"organization_id":"10000000-0000-0000-0000-000000000001","app_user_id":"30000000-0000-0000-0000-000000000001","user_type":"developer","role":"developer"}}',true);
select pg_temp.assert_true((select count(*)=1 from developer_tasks),'Delegate sees assigned task');
select pg_temp.assert_true((select count(*)=1 from notifications where type='task_reassigned'),'Delegate receives transaction notice');
select pg_temp.expect_denied($q$update developer_tasks set developer_id=null,assignee_admin_id='20000000-0000-0000-0000-000000000001' where id='50000000-0000-0000-0000-000000000001'$q$,'Developer cannot reassign');
update developer_tasks set status='in_progress' where id='50000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"90000000-0000-0000-0000-000000000001","app_metadata":{"organization_id":"10000000-0000-0000-0000-000000000001","app_user_id":"20000000-0000-0000-0000-000000000001","user_type":"admin","role":"owner"}}',true);
update developer_tasks set developer_id=null,assignee_admin_id='20000000-0000-0000-0000-000000000002' where id='50000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"90000000-0000-0000-0000-000000000002","app_metadata":{"organization_id":"10000000-0000-0000-0000-000000000001","app_user_id":"30000000-0000-0000-0000-000000000001","user_type":"developer","role":"developer"}}',true);
select pg_temp.assert_true((select count(*)=0 from developer_tasks),'Former delegate loses access');
select pg_temp.assert_true((select count(*)=1 from notifications where type='task_reassigned_away' and task_id is null and project_id is null),'Former delegate receives private removal snapshot');
select set_config('request.jwt.claims','{"sub":"90000000-0000-0000-0000-000000000001","app_metadata":{"organization_id":"10000000-0000-0000-0000-000000000001","app_user_id":"20000000-0000-0000-0000-000000000001","user_type":"developer","role":"developer"}}',true);
select pg_temp.assert_true((select count(*)=0 from developer_tasks),'Cross-profile UUID collision grants no access');
reset role;
-- Seed a proof object as Storage does, then use the real submission/review RPCs.
insert into storage.objects(bucket_id,name,metadata) values('task-submissions','submissions/20000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/proof.txt','{"size":10,"mimetype":"text/plain"}');
select public.commit_task_submission('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','admin','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','https://example.test/proof.txt','proof.txt','submissions/20000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/proof.txt','Owner proof');
select pg_temp.assert_true((select assignee_admin_id='20000000-0000-0000-0000-000000000002' and developer_id is null from task_submissions limit 1),'Submission preserves typed identity');
select pg_temp.expect_denied(format($q$select public.commit_task_review('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','admin','owner-b@example.test','50000000-0000-0000-0000-000000000001',%L,'approve',null,null)$q$,(select id from task_submissions limit 1)),'Owner cannot approve own submission');
select public.commit_task_review('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','admin','owner-a@example.test','50000000-0000-0000-0000-000000000001',(select id from task_submissions limit 1),'approve',null,null);
select pg_temp.assert_true((select status='completed' from developer_tasks limit 1),'Independent authorized Owner reviews work');
select pg_temp.assert_true((select count(*)=1 from admin_reviews where assignee_admin_id='20000000-0000-0000-0000-000000000002'),'Review history preserves Owner identity');
select pg_temp.assert_true((select count(*)=0 from productivity_metrics),'Owner review does not create a fake developer metric');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"90000000-0000-0000-0000-000000000001","app_metadata":{"organization_id":"10000000-0000-0000-0000-000000000001","app_user_id":"20000000-0000-0000-0000-000000000001","user_type":"admin","role":"owner"}}',true);
update developer_tasks set developer_id='30000000-0000-0000-0000-000000000002',assignee_admin_id=null where id='50000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select status='completed' and developer_id='30000000-0000-0000-0000-000000000002' from developer_tasks limit 1),'Existing completed-task reassignment remains available');
reset role;
select pg_temp.assert_true((select count(*)=1 from admin_reviews where assignee_admin_id='20000000-0000-0000-0000-000000000002'),'Reassignment does not rewrite the reviewed author');
rollback;
