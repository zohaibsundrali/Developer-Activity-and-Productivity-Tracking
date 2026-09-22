-- Synthetic seed for an EMPTY full-schema local database after the migration.
-- Test-only workspace resolver. Production workspace/session functions are
-- exercised separately with real QA JWTs; all task policies/triggers stay live.
create or replace function public.auth_org() returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
select organization_id from public.memberships where organization_id=(auth.jwt()->'app_metadata'->>'organization_id')::uuid
and user_id=public.auth_app_user_id() and user_type=auth.jwt()->'app_metadata'->>'user_type' and status='active'; $$;
set session_replication_role=replica;
insert into organizations(id,name) values('10000000-0000-0000-0000-000000000001','Owner assignment QA'),('10000000-0000-0000-0000-000000000002','Other QA');
insert into admin_users(id,organization_id,full_name,company,email) values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner A','QA','owner-a@example.test'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Owner B','QA','owner-b@example.test'),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Foreign Owner','QA','owner-c@example.test');
insert into developers(id,organization_id,name,email) values
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Developer','dev@example.test'),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Employee','employee@example.test'),
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Same UUID different profile','collision@example.test');
insert into memberships(organization_id,user_id,user_type,role) select organization_id,id,'admin','owner' from admin_users;
insert into memberships(organization_id,user_id,user_type,role) select organization_id,id,'developer',case when name='Employee' then 'employee' else 'developer' end from developers;
insert into projects(id,organization_id,name,created_by,created_by_type,manager_id,manager_type) values
('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Assignment QA','20000000-0000-0000-0000-000000000001','admin','20000000-0000-0000-0000-000000000002','admin');
insert into storage.buckets(id,name,public) values('task-submissions','task-submissions',false);
set session_replication_role=origin;

insert into app_private.billing_accounts(id) select id from organizations;
insert into app_private.organization_billing(organization_id,account_id) select id,id from organizations;
insert into public.billing_plans(code,name,limits,features) values('free','QA', '{"active_tasks":-1,"projects":-1,"storage_mb":-1,"employees":-1,"clients":-1,"seats":-1}', '{"client_portal":true,"reports":true,"automation":true}');
