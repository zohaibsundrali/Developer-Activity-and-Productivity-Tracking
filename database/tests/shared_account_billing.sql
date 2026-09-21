\set ON_ERROR_STOP on
\ir authenticated_organization_workspaces.sql
-- Extend the signup fixture with production billing/storage columns.
alter table organizations add column created_at timestamptz default now();
alter table organization_subscriptions add column stripe_customer_id text,add column stripe_subscription_id text;
-- Earlier workspace tests intentionally create independent paid trials. Clear
-- those test grants before testing the shared-account migration.
update organization_subscriptions set plan_code='free',status='active';
create function public.auth_tracking_history(uuid,jsonb) returns boolean language sql as $$select true$$;
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now());
\ir ../../supabase/migrations/20260911062113_production_storage_accounting.sql
create function app_private.qa_existing_entrypoint() returns integer language sql as $$select 1$$;
revoke all on function app_private.qa_existing_entrypoint() from public,anon;
grant execute on function app_private.qa_existing_entrypoint() to authenticated;
\ir ../../supabase/migrations/20260920070343_shared_account_billing.sql
do $$begin
 if not has_function_privilege('authenticated','app_private.qa_existing_entrypoint()','execute') then
  raise exception 'Shared billing revoked an unrelated feature entrypoint';
 end if;
end$$;

do $$ declare uid uuid; anchor uuid; child uuid; profile uuid; w jsonb; rid uuid:=gen_random_uuid(); scope jsonb; root_projects bigint;
begin
 select id into uid from auth.users where email='owner@example.test';
 select id into anchor from app_private.billing_accounts where owner_auth_id=uid;
 if anchor is null then raise exception 'Account owner was not backfilled'; end if;
 -- Raise unrelated test limits and bound the combined project/storage counters.
 update billing_plans set limits='{"employees":100,"developers":100,"projects":2,"active_tasks":2,"screenshots":2,"storage_mb":1,"tracking_history_days":7}' where code='free';
 w:=create_authenticated_workspace(uid,rid,'{"company":"Shared child"}','professional','v1');
 child:=(w->>'organizationId')::uuid; profile:=(w->>'profileId')::uuid;
 if w is distinct from create_authenticated_workspace(uid,rid,'{"company":"Retry"}','enterprise','v1') then raise exception 'Creation not idempotent'; end if;
 if exists(select 1 from organization_subscriptions where organization_id=child) then raise exception 'Child created another subscription'; end if;
 scope:=billing_scope(child);
 if scope->>'accountId'<>anchor::text then raise exception 'Wrong shared account'; end if;
 if scope->>'ownerAuthId'<>uid::text then raise exception 'Wrong billing payer'; end if;
 delete from projects where organization_id in(select app_private.billing_organizations(anchor));
 insert into projects(organization_id,name) values(anchor,'One'),(child,'Two');
 perform expect_rejected(format('insert into projects(organization_id,name) values(%L,''Three'')',child),'PLAN_LIMIT_REACHED');
 perform expect_rejected(format('insert into projects(organization_id,name) values(%L,''Three'')',anchor),'PLAN_LIMIT_REACHED');
 insert into storage.objects(bucket_id,name,metadata) values('org-files',anchor||'/one','{"size":524288}'),('org-files',child||'/two','{"size":524288}');
 perform expect_rejected(format('insert into storage.objects(bucket_id,name,metadata) values(''org-files'',%L,''{"size":1}'')',child||'/three'),'PLAN_LIMIT_REACHED');
 if (select sum(bytes) from app_private.storage_usage where organization_id in(select app_private.billing_organizations(child)))<>1048576 then raise exception 'Storage not combined'; end if;
 -- Changes to the one subscription affect both workspaces without propagation.
 update organization_subscriptions set plan_code='professional',status='unpaid' where organization_id=anchor;
 if app_private.org_unlocked(child) then raise exception 'Unpaid account did not lock child'; end if;
 perform expect_rejected(format('insert into projects(organization_id,name) values(%L,''Locked'')',child),'BILLING_LOCKED');
 update organization_subscriptions set plan_code='free',status='active' where organization_id=anchor;
 perform expect_rejected(format('delete from organizations where id=%L',anchor),'SHARED_BILLING_ACCOUNT');
 perform expect_rejected(format('insert into app_private.organization_deletions(organization_id) values(%L)',anchor),'SHARED_BILLING_ACCOUNT');
 if not exists(select 1 from pg_constraint where conrelid='app_private.billing_accounts'::regclass and confrelid='auth.users'::regclass and confdeltype='n') then raise exception 'Account mapping blocks final Auth cleanup'; end if;
 if has_function_privilege('authenticated','public.billing_scope(uuid)','execute') or has_function_privilege('anon','public.billing_scope(uuid)','execute') then raise exception 'Billing scope exposed'; end if;
 if has_table_privilege('authenticated','app_private.organization_billing','select') then raise exception 'Private account map exposed'; end if;
end $$;
