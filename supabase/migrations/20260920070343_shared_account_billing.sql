begin;
lock table public.organizations, public.organization_subscriptions in access exclusive mode;
-- Billing anchors retain the original subscription, Stripe identity and history.
-- Membership/data authorization continues to use the actual workspace ID.
create table app_private.billing_accounts (
 id uuid primary key references public.organizations(id) on delete cascade,
 owner_auth_id uuid unique references auth.users(id) on delete set null
);
create table app_private.organization_billing (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 account_id uuid not null references app_private.billing_accounts(id) on delete cascade
);
create index organization_billing_account on app_private.organization_billing(account_id);
alter table app_private.billing_accounts enable row level security;
alter table app_private.organization_billing enable row level security;
revoke all on app_private.billing_accounts,app_private.organization_billing from public,anon,authenticated,service_role;

-- Never silently abandon a second paid subscription/customer during migration.
-- Reconcile such accounts before retrying this all-or-nothing migration.
do $$ declare o record; anchor uuid; payer uuid;
begin
 for o in select org.id,a.auth_user_id from public.organizations org
 left join public.admin_users a on a.id=org.owner_id order by org.created_at,org.id loop
  anchor:=null;
  if o.auth_user_id is not null then select id into anchor from app_private.billing_accounts where owner_auth_id=o.auth_user_id; end if;
  if anchor is null then
   anchor:=o.id; insert into app_private.billing_accounts values(anchor,o.auth_user_id);
  elsif exists(select 1 from public.organization_subscriptions where organization_id=o.id and
   (plan_code<>'free' or stripe_customer_id is not null or stripe_subscription_id is not null)) then
   raise exception 'BILLING_RECONCILIATION_REQUIRED: secondary organization % has its own paid plan or Stripe customer',o.id;
  end if;
  insert into app_private.organization_billing values(o.id,anchor);
 end loop;
end $$;

create function app_private.billing_account(p_org uuid) returns uuid
language sql stable security definer set search_path=pg_catalog as $$
 select account_id from app_private.organization_billing where organization_id=p_org;
$$;
create function app_private.billing_organizations(p_org uuid) returns setof uuid
language sql stable security definer set search_path=pg_catalog as $$
 select organization_id from app_private.organization_billing where account_id=app_private.billing_account(p_org);
$$;
create function public.billing_scope(p_org uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('accountId',a.id,'ownerAuthId',a.owner_auth_id,
 'organizationIds',(select jsonb_agg(organization_id order by organization_id) from app_private.organization_billing where account_id=a.id))
 from app_private.billing_accounts a where a.id=app_private.billing_account(p_org);
$$;
revoke all on function public.billing_scope(uuid) from public,anon,authenticated;
grant execute on function public.billing_scope(uuid) to service_role;

create function app_private.attach_billing_account() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare payer uuid; anchor uuid;
begin
 select auth_user_id into payer from public.admin_users where id=new.owner_id;
 if payer is not null then
  perform pg_advisory_xact_lock(hashtextextended('billing-account:'||payer::text,0));
  select id into anchor from app_private.billing_accounts where owner_auth_id=payer;
 end if;
 if anchor is null then
  anchor:=new.id; insert into app_private.billing_accounts values(anchor,payer);
 else
  perform app_private.lock_quota(anchor);
  if app_private.organization_deleting(anchor) then raise exception 'WORKSPACE_FORBIDDEN: billing account is being deleted'; end if;
 end if;
 insert into app_private.organization_billing values(new.id,anchor);
 return new;
end $$;
create trigger aaa_attach_billing_account after insert on public.organizations
for each row execute function app_private.attach_billing_account();

-- A secondary organization never starts another trial or buys a second plan.
create function app_private.guard_shared_subscription() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if app_private.billing_account(new.organization_id) is distinct from new.organization_id then
  if tg_op='INSERT' then return null; end if;
  raise exception 'SHARED_ACCOUNT_BILLING: update the account subscription';
 end if;
 return new;
end $$;
create trigger aaa_shared_subscription before insert or update on public.organization_subscriptions
for each row execute function app_private.guard_shared_subscription();
delete from public.organization_subscriptions s using app_private.organization_billing b
where s.organization_id=b.organization_id and b.account_id<>b.organization_id;

-- Keep the billing anchor until its other workspaces are removed. This guard
-- runs BEFORE deletion freezes access or schedules any Stripe cancellation.
create function app_private.guard_billing_anchor_deletion() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;
begin
 if tg_table_name='organizations' then target:=old.id; else target:=new.organization_id; end if;
 perform app_private.lock_quota(target);
 if exists(select 1 from app_private.organization_billing where account_id=target and organization_id<>target) then
  raise exception 'SHARED_BILLING_ACCOUNT: delete the other account workspaces before deleting the original organization' using errcode='23503';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger aaa_guard_billing_anchor before delete on public.organizations
for each row execute function app_private.guard_billing_anchor_deletion();
create trigger aaa_guard_billing_anchor before insert on app_private.organization_deletions
for each row execute function app_private.guard_billing_anchor_deletion();
create or replace function app_private.lock_quota(p_org uuid) returns void
language sql volatile security definer set search_path = pg_catalog, public, app_private
as $$
  insert into app_private.quota_locks(organization_id, revision) values (app_private.billing_account(p_org), 1)
  on conflict (organization_id) do update set revision = quota_locks.revision + 1;
$$;
create or replace function app_private.effective_plan(p_org uuid) returns text
language sql stable security definer set search_path = pg_catalog, public
as $$
  select coalesce((select case
    when s.status in ('active','trialing','past_due')
      and (s.status <> 'trialing' or s.trial_end is null or now() <= s.trial_end)
      and (s.status <> 'past_due' or s.grace_period_ends_at is null or now() <= s.grace_period_ends_at)
      and (s.last_payment_status is distinct from 'demo_paid' or s.current_period_end is null or now() <= s.current_period_end)
    then s.plan_code else 'free' end
    from public.organization_subscriptions s where s.organization_id = app_private.billing_account(p_org)), 'free');
$$;
create or replace function app_private.org_unlocked(p_org uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select p_org is not null and coalesce((select case
    when s.plan_code = 'free' then true
    when s.status = 'trialing' then s.trial_end is null or now() <= s.trial_end
    when s.status = 'past_due' then s.grace_period_ends_at is null or now() <= s.grace_period_ends_at
    when s.status = 'unpaid' then false
    else true end from public.organization_subscriptions s where s.organization_id = app_private.billing_account(p_org)), true);
$$;
create or replace function app_private.enforce_resource_quota() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, public, app_private
as $$
declare resource text := tg_argv[0]; used bigint; ceiling bigint;
  increases boolean := true; old_org uuid; excluded_id text;
begin
  if new.organization_id is null then
    raise exception 'Organization is required' using errcode = '23502';
  end if;
  if tg_op = 'UPDATE' then
    old_org := old.organization_id;
    excluded_id := old.id::text;
    increases := old_org is distinct from new.organization_id;
  end if;
  if resource = 'employees' then
    if new.user_type = 'client' then return new; end if;
    if tg_op = 'UPDATE' then increases := increases or old.user_type = 'client'; end if;
  elsif resource = 'active_tasks' then
    if new.status is null or new.status not in ('pending','in_progress','awaiting_approval','reviewed') then return new; end if;
    if tg_op = 'UPDATE' then
      increases := increases or old.status is null or old.status not in ('pending','in_progress','awaiting_approval','reviewed');
    end if;
  end if;
  if not increases then return new; end if;
  perform app_private.lock_quota(new.organization_id);
  if not app_private.org_unlocked(new.organization_id) then
    raise exception 'BILLING_LOCKED: subscription requires attention' using errcode = 'P0001';
  end if;
  ceiling := app_private.plan_limit(new.organization_id, resource);
  if ceiling = -1 then return new; end if;
  -- Count real rows, including existing installations and changes made by the
  -- service role. Every increasing write holds the same organization lock.
  if resource = 'employees' then
    select count(*) into used from public.memberships where organization_id in (select app_private.billing_organizations(new.organization_id)) and user_type <> 'client' and id::text is distinct from excluded_id;
  elsif resource = 'active_tasks' then
    select count(*) into used from public.developer_tasks where organization_id in (select app_private.billing_organizations(new.organization_id)) and status in ('pending','in_progress','awaiting_approval','reviewed') and id::text is distinct from excluded_id;
  else
    execute format('select count(*) from public.%I where organization_id in (select app_private.billing_organizations($1)) and id::text is distinct from $2', tg_table_name)
      into used using new.organization_id, excluded_id;
  end if;
  if used >= ceiling then
    raise exception 'PLAN_LIMIT_REACHED: % (% of %). Reduce usage or upgrade.', resource, used, ceiling using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create or replace function app_private.account_storage_object() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog,public,app_private
as $$
declare org uuid; old_org uuid; byte_count bigint; old_bytes bigint; used numeric; ceiling bigint;
begin
  if tg_op='DELETE' then
    delete from app_private.storage_usage where object_id=old.id::text;
    return old;
  end if;
  if new.bucket_id not in ('monitoring','screenshots','documents','org-files','invoices','task-submissions') then
    -- Moving to an unmetered bucket is not a supported application operation.
    if exists(select 1 from app_private.storage_usage where object_id=new.id::text) then
      raise exception 'STORAGE_BUCKET_NOT_ALLOWED' using errcode='P0001';
    end if;
    return new;
  end if;
  org:=app_private.storage_org(new.bucket_id,new.name);
  if org is null then raise exception 'STORAGE_MAPPING_REQUIRED: organization path required' using errcode='P0001'; end if;
  byte_count:=app_private.object_bytes(new.metadata);
  select organization_id,bytes into old_org,old_bytes from app_private.storage_usage where object_id=new.id::text;
  perform app_private.lock_quota(org);
  if old_org is distinct from org or byte_count > coalesce(old_bytes,0) then
    if not app_private.org_unlocked(org) then raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001'; end if;
    ceiling:=app_private.plan_limit(org,'storage_mb');
    if ceiling<>-1 then
      select coalesce(sum(bytes),0) into used from app_private.storage_usage where organization_id in (select app_private.billing_organizations(org)) and object_id<>new.id::text;
      if used+byte_count > ceiling::numeric*1048576 then
        raise exception 'PLAN_LIMIT_REACHED: storage_mb. Remove files or upgrade.' using errcode='P0001';
      end if;
    end if;
  end if;
  insert into app_private.storage_usage(object_id,organization_id,bytes) values(new.id::text,org,byte_count)
    on conflict(object_id) do update set organization_id=excluded.organization_id,bytes=excluded.bytes;
  return new;
end; $$;
create or replace function public.organization_storage_usage(p_org uuid) returns bigint
language plpgsql stable security definer set search_path = pg_catalog,public,app_private
as $$ begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and (auth.uid() is null or p_org is distinct from public.auth_org()) then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  return (select coalesce(sum(bytes),0)::bigint from app_private.storage_usage where organization_id in (select app_private.billing_organizations(p_org)));
end; $$;
create or replace function public.create_authenticated_workspace(p_auth uuid,p_request uuid,p_details jsonb,p_plan text,p_terms text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare u auth.users%rowtype; oid uuid; pid uuid:=gen_random_uuid(); plan public.billing_plans%rowtype; display_name text;
begin
 if p_request is null or jsonb_typeof(p_details) is distinct from 'object'
 or length(btrim(coalesce(p_details->>'company',''))) not between 1 and 200
 or coalesce(length(p_terms),0)=0 then raise exception 'WORKSPACE_INVALID'; end if;
 select * into u from auth.users where id=p_auth for share;
 if u.id is null or u.email_confirmed_at is null or u.deleted_at is not null or (u.banned_until is not null and u.banned_until>now()) then raise exception 'WORKSPACE_UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace-create:'||p_auth::text,0));
 select organization_id into oid from app_private.workspace_creations where auth_user_id=p_auth and request_id=p_request;
 if oid is not null then
  select profile_id into pid from app_private.accessible_workspaces(p_auth) where organization_id=oid and role='owner';
  if pid is null then raise exception 'WORKSPACE_FORBIDDEN'; end if;
  return jsonb_build_object('organizationId',oid,'profileId',pid,'userType','admin');
 end if;
 -- Bound accidental/replayed creation while allowing normal repeat use.
 if (select count(*) from app_private.workspace_creations where auth_user_id=p_auth and created_at>now()-interval '1 hour')>=5 then raise exception 'WORKSPACE_RATE_LIMIT'; end if;
 select full_name into display_name from app_private.accessible_workspaces(p_auth) order by (role='owner') desc limit 1;
 -- An existing verified account can also create a workspace after its last
 -- membership is removed. This name is display-only, never authorization.
 display_name:=left(coalesce(nullif(display_name,''),split_part(u.email,'@',1)),120);
 -- Plan belongs to the account. The legacy p_plan argument is ignored.
 select * into plan from public.billing_plans where code='free' and is_active=true;
 if plan.code is null then select * into plan from public.billing_plans where code='free' and is_active=true; end if;
 if plan.code is null then raise exception 'WORKSPACE_PLAN_UNAVAILABLE'; end if;
 if not exists(select 1 from pg_timezone_names where name=coalesce(nullif(p_details->>'timezone',''),'UTC')) then raise exception 'WORKSPACE_INVALID'; end if;
 oid:=gen_random_uuid();
 insert into public.admin_users(id,full_name,company,email,is_verified,role,auth_user_id)
 values(pid,display_name,btrim(p_details->>'company'),lower(btrim(u.email)),true,'admin',p_auth);
 insert into public.organizations(id,name,owner_id,industry,company_size,country,timezone)
 values(oid,btrim(p_details->>'company'),pid,left(p_details->>'industry',200),left(p_details->>'companySize',100),left(p_details->>'country',100),coalesce(nullif(p_details->>'timezone',''),'UTC'));
 update public.admin_users set organization_id=oid where id=pid;
 insert into public.organization_subscriptions(organization_id,plan_code,status,trial_start,trial_end)
 values(oid,plan.code,case when plan.code='free' then 'active' else 'trialing' end,
 case when plan.code<>'free' then now() end,case when plan.code<>'free' then now()+make_interval(days=>plan.trial_days::integer) end);
 insert into public.memberships(organization_id,user_id,user_type,email,role,status) values(oid,pid,'admin',lower(btrim(u.email)),'owner','active');
 insert into public.terms_acceptances(organization_id,user_id,user_type,email,document,document_version,entry_point,accepted_at)
 values(oid,pid,'admin',lower(btrim(u.email)),'terms_of_service',p_terms,'signup',now());
 insert into app_private.workspace_creations(auth_user_id,request_id,organization_id) values(p_auth,p_request,oid);
 return jsonb_build_object('organizationId',oid,'profileId',pid,'userType','admin');
end $$;
-- Scope revocation to billing internals. Other features deliberately expose
-- guarded private entrypoints through SECURITY INVOKER public wrappers.
revoke all on function app_private.billing_account(uuid),app_private.billing_organizations(uuid),
 app_private.attach_billing_account(),app_private.guard_shared_subscription(),app_private.guard_billing_anchor_deletion(),
 app_private.lock_quota(uuid),app_private.effective_plan(uuid),app_private.org_unlocked(uuid),
 app_private.enforce_resource_quota(),app_private.account_storage_object() from public,anon,authenticated;
commit;
