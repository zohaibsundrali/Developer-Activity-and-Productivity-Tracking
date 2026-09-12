-- Exercise the actual trusted review transaction and its typed manager checks.
\ir typed_project_ownership.sql
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table developers(id uuid primary key,organization_id uuid);
insert into developers select distinct user_id,organization_id from memberships where user_type='developer';
alter table productivity_metrics enable row level security;
-- Use the production physical quota-lock implementation for concurrent tests.
create table app_private.quota_locks(organization_id uuid primary key,revision bigint not null);
create or replace function app_private.lock_quota(p_org uuid) returns void language sql volatile security definer set search_path=pg_catalog,public,app_private as $$
 insert into app_private.quota_locks(organization_id,revision) values(p_org,1) on conflict(organization_id) do update set revision=quota_locks.revision+1;
$$;
create table productivity_test_plan(paid boolean not null);
insert into productivity_test_plan values(true);
grant select on productivity_test_plan to authenticated,service_role;
create or replace function auth_plan_feature(k text) returns boolean language sql stable as $$select paid from productivity_test_plan$$;

\ir ../../supabase/migrations/20260912132120_production_canonical_productivity_recalculation.sql
do $$declare org uuid:='74000000-0000-0000-0000-000000000001'; project uuid:='74000000-0000-0000-0000-000000000102'; dev uuid:='74000000-0000-0000-0000-000000000011'; reviewer uuid:='74000000-0000-0000-0000-000000000012'; task uuid; proof uuid; r jsonb;begin
 insert into developer_tasks(organization_id,project_id,developer_id,status,task_title,end_date) values(org,project,dev,'awaiting_approval','Manager review compatibility','2026-09-15') returning id into task;
 insert into task_submissions(organization_id,task_id,project_id,developer_id,submitted_at) values(org,task,project,dev,'2026-09-14T10:00Z') returning id into proof;
 set local role service_role;
 r:=commit_task_review(org,reviewer,'developer','manager@example.test',task,proof,'approve',null,null);
 reset role;
 if r->>'success'<>'true' or not exists(select 1 from productivity_metrics where organization_id=org and developer_id=dev and project_id=project and completed_on_time>=1) then raise exception 'Trusted manager review broke canonical metric update';end if;
end$$;
