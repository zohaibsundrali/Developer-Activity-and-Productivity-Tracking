-- Apply after the two audit migrations. Existing rows are preserved on downgrade.
-- Limits apply to increases in usage, including reopened tasks and tenant moves.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- A physical write serializes quota checks even at REPEATABLE READ: a competing
-- transaction must see the previous commit or receive a serialization failure.
-- Advisory locks alone do not refresh a REPEATABLE READ snapshot.
create table if not exists app_private.quota_locks (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  revision bigint not null default 0
);
revoke all on app_private.quota_locks from public, anon, authenticated;

create or replace function app_private.lock_quota(p_org uuid) returns void
language sql volatile security definer set search_path = pg_catalog, public, app_private
as $$
  insert into app_private.quota_locks(organization_id, revision) values (p_org, 1)
  on conflict (organization_id) do update set revision = quota_locks.revision + 1;
$$;

-- Keep the existing product policy: canceled/expired falls back to Free;
-- expired trials, expired dunning grace and unpaid PAID plans are write-locked.
-- Real active Stripe subscriptions survive webhook renewal latency. Demo grants
-- have no automatic renewal and therefore expire at current_period_end.
create or replace function app_private.effective_plan(p_org uuid) returns text
language sql stable security definer set search_path = pg_catalog, public
as $$
  select coalesce((select case
    when s.status in ('active','trialing','past_due')
      and (s.status <> 'trialing' or s.trial_end is null or now() <= s.trial_end)
      and (s.status <> 'past_due' or s.grace_period_ends_at is null or now() <= s.grace_period_ends_at)
      and (s.last_payment_status is distinct from 'demo_paid' or s.current_period_end is null or now() <= s.current_period_end)
    then s.plan_code else 'free' end
    from public.organization_subscriptions s where s.organization_id = p_org), 'free');
$$;

create or replace function app_private.org_unlocked(p_org uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select p_org is not null and coalesce((select case
    when s.plan_code = 'free' then true
    when s.status = 'trialing' then s.trial_end is null or now() <= s.trial_end
    when s.status = 'past_due' then s.grace_period_ends_at is null or now() <= s.grace_period_ends_at
    when s.status = 'unpaid' then false
    else true end from public.organization_subscriptions s where s.organization_id = p_org), true);
$$;

create or replace function public.auth_org_unlocked() returns boolean
language sql stable security definer set search_path = pg_catalog, public, app_private
as $$ select app_private.org_unlocked(public.auth_org()); $$;
revoke all on function public.auth_org_unlocked() from public;
grant execute on function public.auth_org_unlocked() to authenticated;

create or replace function app_private.plan_limit(p_org uuid, p_resource text) returns bigint
language plpgsql stable security definer set search_path = pg_catalog, public, app_private
as $$
declare value text; effective_code text;
begin
  effective_code := app_private.effective_plan(p_org);
  select limits->>p_resource into value from public.billing_plans where billing_plans.code = effective_code;
  if not found then raise exception 'BILLING_UNAVAILABLE: plan configuration missing' using errcode = 'P0001'; end if;
  if value is null or value !~ '^(-1|[0-9]+)$' then
    raise exception 'BILLING_UNAVAILABLE: invalid limit for %', p_resource using errcode = 'P0001';
  end if;
  return value::bigint;
end;
$$;

-- Retain the historical signature for existing callers; enforcement uses the
-- private bigint resolver so malformed/overflowed limits can never be unlimited.
create or replace function public.plan_limit_for(org uuid, resource text) returns integer
language plpgsql stable security definer set search_path = pg_catalog, public, app_private
as $$ begin
  if session_user <> 'postgres' and org is distinct from public.auth_org() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  return app_private.plan_limit(org, resource)::integer;
end; $$;
revoke all on function public.plan_limit_for(uuid,text) from public;
grant execute on function public.plan_limit_for(uuid,text) to authenticated;

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
    select count(*) into used from public.memberships where organization_id = new.organization_id and user_type <> 'client' and id::text is distinct from excluded_id;
  elsif resource = 'active_tasks' then
    select count(*) into used from public.developer_tasks where organization_id = new.organization_id and status in ('pending','in_progress','awaiting_approval','reviewed') and id::text is distinct from excluded_id;
  else
    execute format('select count(*) from public.%I where organization_id = $1 and id::text is distinct from $2', tg_table_name)
      into used using new.organization_id, excluded_id;
  end if;
  if used >= ceiling then
    raise exception 'PLAN_LIMIT_REACHED: % (% of %). Reduce usage or upgrade.', resource, used, ceiling using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_project_limit on public.projects;
drop trigger if exists trg_enforce_active_task_limit on public.developer_tasks;
do $$
declare item record;
begin
  for item in select * from (values ('projects','projects'), ('developer_tasks','active_tasks'),
    ('memberships','employees'), ('developers','developers'), ('screenshots','screenshots')) as mapping(tbl,resource)
  loop
    execute format('drop trigger if exists zzz_resource_quota on public.%I', item.tbl);
    execute format('create trigger zzz_resource_quota before insert or update on public.%I for each row execute function app_private.enforce_resource_quota(%L)', item.tbl, item.resource);
  end loop;
end; $$;

-- Plan changes share the quota lock. Quotas and a simultaneous downgrade have
-- a definite order; downgrades never delete existing customer data.
create or replace function app_private.serialize_subscription() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, public, app_private
as $$ begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.organizations where id = old.organization_id) then
      perform app_private.lock_quota(old.organization_id);
    end if;
    return old;
  end if;
  perform app_private.lock_quota(new.organization_id); return new;
end; $$;
drop trigger if exists serialize_subscription_quota on public.organization_subscriptions;
create trigger serialize_subscription_quota before insert or update or delete on public.organization_subscriptions
for each row execute function app_private.serialize_subscription();
revoke all on all functions in schema app_private from public, anon, authenticated;
commit;
