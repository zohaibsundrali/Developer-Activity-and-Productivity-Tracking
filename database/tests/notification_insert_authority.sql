\set ON_ERROR_STOP on
\ir typed_notification_fixture.sql
\ir ../../supabase/migrations/20260911095635_production_typed_notification_recipients.sql
alter table memberships add column role text default 'developer';
alter table notifications add column actor_id uuid,add column type text,add column message text,
 add column task_id uuid,add column project_id uuid,add column submission_id uuid,add column entity_type text,add column entity_id uuid;
create function try_uuid(v text) returns uuid language plpgsql immutable as $$ begin return v::uuid; exception when invalid_text_representation then return null; end $$;
create table developer_tasks(id uuid primary key,organization_id uuid,project_id uuid,developer_id uuid);
create table task_submissions(id uuid primary key,organization_id uuid,task_id uuid,project_id uuid);
alter table developer_tasks enable row level security;
alter table projects enable row level security;
alter table task_submissions enable row level security;
-- Fixture visibility exposes only sender-owned tasks, sameorg projects/proofs;
-- verifies the INSERT trigger actually obeys invoker RLS for each reference.
create policy task_own on developer_tasks for select to authenticated using(organization_id=auth_org() and developer_id=auth_app_user_id());
create policy project_org on projects for select to authenticated using(organization_id=auth_org());
create policy proof_org on task_submissions for select to authenticated using(organization_id=auth_org());
grant select on memberships,projects,developer_tasks,task_submissions to authenticated;
\ir ../../supabase/migrations/20260911081955_production_notification_update_guard.sql
\ir ../../supabase/migrations/20260911131810_production_notification_insert_authority.sql
insert into projects(id,organization_id) values
 ('77000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001'),
 ('77000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001'),
 ('77000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000002');
insert into developer_tasks values
 ('77000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000011'),
 ('77000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000012');
insert into task_submissions values
 ('77000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000201','77000000-0000-0000-0000-000000000101'),
 ('77000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000202','77000000-0000-0000-0000-000000000101');
create function insert_notice(patch jsonb) returns void language plpgsql security invoker as $$ declare n notifications%rowtype; begin
 n:=jsonb_populate_record(null::notifications,jsonb_build_object('id',gen_random_uuid(),'organization_id','00000000-0000-0000-0000-000000000001','developer_id','00000000-0000-0000-0000-000000000012','type','task_comment','title','test')||patch);
 insert into notifications(id,organization_id,developer_id,type,title,actor_id,actor_type,task_id,project_id,submission_id,entity_type,entity_id)
 values(n.id,n.organization_id,n.developer_id,n.type,n.title,n.actor_id,n.actor_type,n.task_id,n.project_id,n.submission_id,n.entity_type,n.entity_id);
end $$;
create function expect_notice_denied(patch jsonb) returns void language plpgsql security invoker as $$ begin
 begin perform insert_notice(patch); exception when insufficient_privilege or check_violation then return; end;
 raise exception 'Forbidden notification accepted: %',patch;
end $$;
do $$ declare org uuid:='00000000-0000-0000-0000-000000000001'; actor uuid:='00000000-0000-0000-0000-000000000011'; begin
 perform set_config('request.jwt.claims',jsonb_build_object('app_metadata',jsonb_build_object('organization_id',org,'app_user_id',actor,'user_type','developer'))::text,true);
 set local role authenticated;
 perform insert_notice('{"actor_id":"00000000-0000-0000-0000-000000000012","actor_type":"admin","task_id":"77000000-0000-0000-0000-000000000201","project_id":"77000000-0000-0000-0000-000000000101","submission_id":"77000000-0000-0000-0000-000000000301"}');
 perform expect_notice_denied('{"project_id":"77000000-0000-0000-0000-000000000103"}');
 perform expect_notice_denied('{"task_id":"77000000-0000-0000-0000-000000000202"}');
 perform expect_notice_denied('{"task_id":"77000000-0000-0000-0000-000000000201","project_id":"77000000-0000-0000-0000-000000000102"}');
 perform expect_notice_denied('{"submission_id":"77000000-0000-0000-0000-000000000302"}');
 perform expect_notice_denied('{"entity_type":"task","entity_id":"77000000-0000-0000-0000-000000000202"}');
 perform expect_notice_denied('{"entity_type":"task","entity_id":"77000000-0000-0000-0000-000000000201","task_id":"77000000-0000-0000-0000-000000000202"}');
 perform expect_notice_denied('{"type":"task_approved"}');
 perform expect_notice_denied('{"type":"task_plan_rejected"}');
 perform expect_notice_denied('{"type":"billing.payment_failed"}');
 perform insert_notice('{"developer_id":"00000000-0000-0000-0000-000000000011"}');
 begin update notifications set actor_type='admin' where title='test'; raise exception 'Actor type update forged'; exception when insufficient_privilege then null; end;
 -- Old recipient need not retain task visibility after a handover. Sender must.
 perform insert_notice('{"type":"task_reassigned_away","task_id":"77000000-0000-0000-0000-000000000201"}');
 reset role;
 if exists(select 1 from notifications where title='test' and (actor_id is distinct from actor or actor_type is distinct from 'developer')) then raise exception 'Browser actor attribution forged'; end if;
 -- Trusted transactional notice remains available, independently of sender RLS.
 set local role service_role;
 perform insert_notice('{"type":"task_approved","task_id":"77000000-0000-0000-0000-000000000202"}');
 reset role;
end $$;
-- Authenticated transaction RPC executes its nested insert as its trusted owner.
create function test_authoritative_notice() returns void language plpgsql security definer set search_path=public as $$ begin
 perform insert_notice('{"type":"task_plan_approved"}');
end $$;
set role authenticated;
select test_authoritative_notice();
reset role;
