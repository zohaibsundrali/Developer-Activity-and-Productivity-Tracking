begin;
create table app_private.platform_owners (
 auth_user_id uuid primary key references auth.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
alter table app_private.platform_owners enable row level security;
revoke all on app_private.platform_owners from public, anon, authenticated, service_role;
create table app_private.platform_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null,
 organization_id uuid, action text not null, reason text not null,
 created_at timestamptz not null default now()
);
create index platform_audit_recent on app_private.platform_audit(created_at desc,id);
alter table app_private.platform_audit enable row level security;
revoke all on app_private.platform_audit from public, anon, authenticated, service_role;

create function public.platform_owner_access(p_auth uuid, p_session uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,app_private as $$
 select exists(select 1 from app_private.platform_owners p
 join auth.users u on u.id=p.auth_user_id
 join auth.sessions s on s.user_id=u.id and s.id=p_session
 where p.auth_user_id=p_auth and u.deleted_at is null and u.email_confirmed_at is not null
 and (u.banned_until is null or u.banned_until<=now())
 and ((to_jsonb(s)->>'not_after') is null or (to_jsonb(s)->>'not_after')::timestamptz>now()));
$$;
create function app_private.require_platform_owner(p_auth uuid,p_session uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not public.platform_owner_access(p_auth,p_session) then
  raise exception 'Platform owner access required' using errcode='42501';
 end if;
end $$;
revoke all on function app_private.require_platform_owner(uuid,uuid) from public,anon,authenticated,service_role;

create function public.platform_overview(p_auth uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result jsonb;
begin
 perform app_private.require_platform_owner(p_auth,p_session);
 select jsonb_build_object(
 'organizations',(select count(*) from public.organizations),
 'projects',(select count(*) from public.projects),
 'memberships',(select count(*) from public.memberships where status='active'),
 'admins',(select count(*) from public.admin_users),
 'developers',(select count(*) from public.developers),
 'clients',(select count(*) from public.clients),
 'tasks',(select count(*) from public.developer_tasks),
 'devices',(select count(*) from public.tracker_devices),
 'screenshots',(select count(*) from public.screenshots),
 'deletionsPending',(select count(*) from app_private.organization_deletions where status<>'completed'),
 'subscriptions',coalesce((select jsonb_agg(x) from (select status,count(*) as count from public.organization_subscriptions group by status order by status) x),'[]'::jsonb),
 'revenue',coalesce((select jsonb_agg(x) from (select upper(currency) as currency,sum(coalesce(amount_paid_cents,0)) as paid_cents from public.billing_invoices where status='paid' group by upper(currency)) x),'[]'::jsonb),
 'growth',(select jsonb_agg(x order by month) from (
 select to_char(m,'YYYY-MM') as month,(select count(*) from public.organizations o where o.created_at>=m and o.created_at<m+interval '1 month') as organizations
 from generate_series(date_trunc('month',now())-interval '5 months',date_trunc('month',now()),interval '1 month') m) x),
 'generatedAt',now()) into result;
 return result;
end $$;

create function public.platform_organizations(p_auth uuid,p_session uuid,p_search text default '',p_page integer default 1)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result jsonb; q text:=left(coalesce(p_search,''),100);
begin
 perform app_private.require_platform_owner(p_auth,p_session);
 if p_page<1 or p_page>100000 then raise exception 'Invalid page' using errcode='22023'; end if;
 select jsonb_build_object('total',(select count(*) from public.organizations o where q='' or strpos(lower(o.name),lower(q))>0 or o.id::text=q),
 'page',p_page,'pageSize',20,'items',coalesce((select jsonb_agg(x order by x.created_at desc,x.id) from (
 select o.id,o.name,o.created_at,o.industry,o.country,o.timezone,
 (select count(*) from public.projects p where p.organization_id=o.id) as projects,
 (select count(*) from public.memberships m where m.organization_id=o.id and m.status='active') as members,
 (select count(*) from public.developer_tasks t where t.organization_id=o.id) as tasks,
 (select j.status from app_private.organization_deletions j where j.organization_id=o.id) as deletion_status
 from public.organizations o where q='' or strpos(lower(o.name),lower(q))>0 or o.id::text=q
 order by o.created_at desc,o.id limit 20 offset (p_page-1)*20) x),'[]'::jsonb)) into result;
 return result;
end $$;

create function public.platform_organization_detail(p_auth uuid,p_session uuid,p_org uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result jsonb; billing_org uuid:=p_org;
begin
 perform app_private.require_platform_owner(p_auth,p_session);
 -- Shared-account billing is optional; never invent a free plan for a child.
 if to_regprocedure('app_private.billing_account(uuid)') is not null then
  execute 'select app_private.billing_account($1)' into billing_org using p_org;
 end if;
 select jsonb_build_object('organization',jsonb_build_object('id',o.id,'name',o.name,'created_at',o.created_at,'industry',o.industry,'country',o.country,'timezone',o.timezone),
 'stats',jsonb_build_object(
 'projects',(select count(*) from public.projects where organization_id=p_org),
 'members',(select count(*) from public.memberships where organization_id=p_org and status='active'),
 'tasks',(select count(*) from public.developer_tasks where organization_id=p_org),
 'devices',(select count(*) from public.tracker_devices where organization_id=p_org),
 'screenshots',(select count(*) from public.screenshots where organization_id=p_org)),
 'billingOrganizationId',billing_org,
 'subscription',(select jsonb_build_object('plan_code',s.plan_code,'status',s.status,'current_period_end',s.current_period_end,'trial_end',s.trial_end,'cancel_at_period_end',s.cancel_at_period_end,'last_payment_status',s.last_payment_status) from public.organization_subscriptions s where s.organization_id=billing_org),
 'deletion',(select jsonb_build_object('status',j.status,'stage',j.stage,'attempts',j.attempts,'last_error',j.last_error,'created_at',j.created_at) from app_private.organization_deletions j where j.organization_id=p_org)) into result
 from public.organizations o where o.id=p_org;
 return result;
end $$;

-- Extend the existing leased cleanup entry point; organization-owner checks remain intact.
create or replace function public.start_organization_deletion(p_org uuid,p_actor uuid,p_type text,p_auth uuid,p_name text,p_receipt_hash text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare m public.memberships%rowtype; j app_private.organization_deletions%rowtype; org_name text; linked uuid; busy boolean; nonce uuid:=gen_random_uuid();
begin
 perform app_private.lock_quota(p_org);
 if p_type='platform' then
  if p_actor is distinct from p_auth or not exists(select 1 from app_private.platform_owners where auth_user_id=p_auth) then
   raise exception 'Platform owner required' using errcode='42501';
  end if;
 else
 select * into m from public.memberships where organization_id=p_org and user_id=p_actor and user_type=p_type and status='active' for update;
 if not found or m.role<>'owner' or p_type not in ('admin','developer') or not coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='organization.delete'),true) then raise exception 'Deletion requires the active owner' using errcode='42501'; end if;
 if p_type='admin' then select auth_user_id into linked from public.admin_users where id=p_actor and organization_id=p_org;
 else select auth_user_id into linked from public.developers where id=p_actor and organization_id=p_org; end if;
 if linked is distinct from p_auth or not exists(select 1 from app_private.accessible_workspaces(p_auth,true) w where w.organization_id=p_org and w.profile_id=p_actor and w.user_type=p_type and w.role='owner') then raise exception 'Owner identity must be verified' using errcode='42501'; end if;
 end if;
 select * into j from app_private.organization_deletions where organization_id=p_org for update;
 if found then
  if p_name is distinct from j.organization_name or p_receipt_hash is null or p_receipt_hash !~ '^[0-9a-f]{64}$' then raise exception 'Confirm the exact organization name' using errcode='22023'; end if;
  update app_private.organization_deletions set receipt_hash=p_receipt_hash where id=j.id;return j.id; end if;
 select name into org_name from public.organizations where id=p_org for update;
 if not found or p_name is distinct from org_name or p_receipt_hash !~ '^[0-9a-f]{64}$' then raise exception 'Confirm the exact organization name' using errcode='22023'; end if;
 if exists(select 1 from storage.objects o where app_private.deletion_storage_org(o.bucket_id,o.name) is null and
  (exists(select 1 from public.screenshots s where s.organization_id=p_org and s.storage_path=o.name)
   or exists(select 1 from auth.users u where u.id::text=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner') and u.raw_app_meta_data->>'organization_id'=p_org::text))) then
  raise exception 'Legacy or ambiguous storage ownership requires repair before organization deletion' using errcode='22023'; end if;
 if to_regclass('app_private.invitation_attempts') is not null then
  execute 'select exists(select 1 from app_private.invitation_attempts a join public.invitations i on i.id=a.invitation_id where i.organization_id=$1 and a.completed_at is null and a.lease_until>now())' into busy using p_org;
  if busy then raise exception 'Invitation acceptance is in progress; retry deletion shortly' using errcode='22023'; end if;
 end if;
 insert into app_private.organization_deletions(organization_id,organization_name,actor_id,actor_type,auth_user_id,receipt_hash,status,lease,lease_until,stripe_customer_id,stripe_subscription_id)
 select p_org,org_name,p_actor,p_type,p_auth,p_receipt_hash,'processing',nonce,now()+interval '10 minutes',s.stripe_customer_id,s.stripe_subscription_id
 from (select 1) x left join public.organization_subscriptions s on s.organization_id=p_org returning * into j;
 perform set_config('app.deletion_lease',nonce::text,true);
 update public.memberships set deletion_blocked=true where organization_id=p_org;
 insert into app_private.organization_deletion_items(job_id,kind,resource_id,bucket,path)
 select j.id,'storage',o.id::text,o.bucket_id,o.name from storage.objects o where app_private.deletion_storage_org(o.bucket_id,o.name)=p_org;
 -- Include only linked profiles in this org. Shared or mismatched links are
 -- marked retained at execution; no password or Auth credential is inspected.
 insert into app_private.organization_deletion_items(job_id,kind,resource_id,profile_id,profile_type)
 select j.id,'auth',auth_user_id::text,id,kind from (
 select id,auth_user_id,'admin'::text kind from public.admin_users where organization_id=p_org and auth_user_id is not null
 union all select id,auth_user_id,'developer' from public.developers where organization_id=p_org and auth_user_id is not null
 union all select id,auth_user_id,'client' from public.clients where organization_id=p_org and auth_user_id is not null) p
 on conflict(job_id,kind,resource_id) do nothing;
 if to_regclass('app_private.invitation_attempts') is not null then
  execute $q$insert into app_private.organization_deletion_items(job_id,kind,resource_id,profile_id,profile_type,invitation_id)
   select $1,'auth',a.auth_user_id::text,a.profile_id,case when i.role='admin' then 'admin' when i.role='client' then 'client' else 'developer' end,i.id
   from app_private.invitation_attempts a join public.invitations i on i.id=a.invitation_id where i.organization_id=$2
   on conflict(job_id,kind,resource_id) do nothing$q$ using j.id,p_org;
 end if;
 update app_private.organization_deletion_items set status='retained' where job_id=j.id and kind='auth' and resource_id in (select auth_user_id::text from app_private.platform_owners);
 update app_private.organization_deletions set status='pending',lease=null,lease_until=null where id=j.id;
 return j.id;
end $$;
create function public.platform_start_deletion(p_auth uuid,p_session uuid,p_org uuid,p_name text,p_reason text,p_receipt_hash text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare job uuid;
begin
 perform app_private.require_platform_owner(p_auth,p_session);
 if p_reason is null or length(trim(p_reason))<8 or length(p_reason)>500 or p_name is null or p_receipt_hash is null then
  raise exception 'Exact name and a reason of 8 to 500 characters required' using errcode='22023';
 end if;
 job:=public.start_organization_deletion(p_org,p_auth,'platform',p_auth,p_name,p_receipt_hash);
 insert into app_private.platform_audit(actor_id,organization_id,action,reason) values(p_auth,p_org,'organization.deletion_requested',trim(p_reason));
 return job;
end $$;
create function public.platform_retry_deletion(p_auth uuid,p_session uuid,p_org uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 perform app_private.require_platform_owner(p_auth,p_session);
 if not exists(select 1 from app_private.organization_deletions where organization_id=p_org and status<>'completed') then return false; end if;
 insert into app_private.platform_audit(actor_id,organization_id,action,reason) values(p_auth,p_org,'organization.deletion_retry','Owner requested cleanup retry');
 return true;
end $$;
create function public.platform_activity(p_auth uuid,p_session uuid,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
begin
 perform app_private.require_platform_owner(p_auth,p_session);
 if p_page<1 or p_page>100000 then raise exception 'Invalid page' using errcode='22023'; end if;
 return jsonb_build_object('total',(select count(*) from app_private.platform_audit),'page',p_page,'pageSize',20,
 'items',coalesce((select jsonb_agg(x order by created_at desc,id) from (select * from app_private.platform_audit order by created_at desc,id limit 20 offset (p_page-1)*20) x),'[]'::jsonb),
 'deletions',coalesce((select jsonb_agg(x order by created_at desc,id) from (select id,organization_id,organization_name,status,stage,attempts,last_error,created_at,completed_at from app_private.organization_deletions where status<>'completed' order by created_at desc,id limit 100) x),'[]'::jsonb),
 'deletionsTotal',(select count(*) from app_private.organization_deletions where status<>'completed'));
end $$;
-- Every public RPC is backend-only; the backend verifies the bearer token first.
do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('platform_owner_access','platform_overview','platform_organizations','platform_organization_detail','platform_start_deletion','platform_retry_deletion','platform_activity') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
