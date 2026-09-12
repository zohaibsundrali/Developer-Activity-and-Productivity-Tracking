begin;
-- Preserve enabled captures; use a documented 60-second default schedule.
create table public.organization_screenshot_policies (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 enabled boolean not null default true,
 interval_seconds integer not null default 60 check(interval_seconds between 60 and 3600),
 updated_at timestamptz not null default now()
);
alter table public.organization_screenshot_policies enable row level security;
revoke all on public.organization_screenshot_policies from public,anon,authenticated;
grant select on public.organization_screenshot_policies to authenticated;
create policy screenshot_policy_tenant_read on public.organization_screenshot_policies for select to authenticated
 using(organization_id=public.auth_org());

create function public.can_manage_screenshot_policy() returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.auth_org() is not null
 and auth.jwt()->'app_metadata'->>'user_type'='admin'
 and public.auth_role() in ('owner','admin')
 and public.auth_override('organization.settings') is distinct from false
 and public.auth_override('organization.manage') is distinct from false;
$$;
revoke all on function public.can_manage_screenshot_policy() from public,anon,authenticated;
grant execute on function public.can_manage_screenshot_policy() to authenticated;

create function public.get_screenshot_policy() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare org uuid:=public.auth_org(); policy public.organization_screenshot_policies%rowtype;
begin
 if auth.uid() is null or org is null then raise exception 'SCREENSHOT_POLICY_UNAUTHORIZED' using errcode='42501'; end if;
 select * into policy from public.organization_screenshot_policies where organization_id=org;
 return jsonb_build_object('organization_id',org,'enabled',coalesce(policy.enabled,true),
 'interval_seconds',coalesce(policy.interval_seconds,60),'updated_at',policy.updated_at,
 'can_manage',coalesce(public.can_manage_screenshot_policy(),false));
end; $$;
revoke all on function public.get_screenshot_policy() from public,anon,authenticated;
grant execute on function public.get_screenshot_policy() to authenticated;

-- Definer is necessary for the single validated mutation; table writes are not
-- granted to API clients. No organization/id arguments can select another tenant.
create function public.set_screenshot_policy(p_enabled boolean,p_interval_seconds integer) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org();
begin
 if public.can_manage_screenshot_policy() is distinct from true then
  raise exception 'SCREENSHOT_POLICY_FORBIDDEN' using errcode='42501';
 end if;
 if p_enabled is null or p_interval_seconds is null or p_interval_seconds not between 60 and 3600 then
  raise exception 'SCREENSHOT_POLICY_INVALID' using errcode='22023';
 end if;
 perform app_private.lock_quota(org);
 -- Privacy restriction remains available when billing is locked.
 if p_enabled and not app_private.org_unlocked(org) then
  raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001';
 end if;
 insert into public.organization_screenshot_policies(organization_id,enabled,interval_seconds)
 values(org,p_enabled,p_interval_seconds)
 on conflict(organization_id) do update set enabled=excluded.enabled,
 interval_seconds=excluded.interval_seconds,updated_at=clock_timestamp();
 return public.get_screenshot_policy();
end; $$;
revoke all on function public.set_screenshot_policy(boolean,integer) from public,anon,authenticated;
grant execute on function public.set_screenshot_policy(boolean,integer) to authenticated;

-- Protect direct Storage/Data API writes as well as the application endpoint.
-- Use the same organization quota lock as finalization/admin changes. The
-- interval controls device scheduling, never batching of older offline images.
create function app_private.guard_screenshot_policy() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid; old_org uuid;
begin
 if tg_table_schema='storage' then
  if tg_op='UPDATE' and old.bucket_id in ('monitoring','screenshots') then
   old_org:=app_private.storage_org(old.bucket_id,old.name);
   perform app_private.lock_quota(old_org);
   if exists(select 1 from public.organization_screenshot_policies where organization_id=old_org and not enabled) then
    raise exception 'SCREENSHOTS_DISABLED' using errcode='42501';
   end if;
  end if;
  if new.bucket_id not in ('monitoring','screenshots') then return new; end if;
  org:=app_private.storage_org(new.bucket_id,new.name);
 else org:=new.organization_id;
 end if;
 if org is null then raise exception 'SCREENSHOT_ORGANIZATION_REQUIRED' using errcode='42501'; end if;
 perform app_private.lock_quota(org);
 if exists(select 1 from public.organization_screenshot_policies where organization_id=org and not enabled) then
  raise exception 'SCREENSHOTS_DISABLED' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function app_private.guard_screenshot_policy() from public,anon,authenticated;
create trigger screenshot_policy_write before insert or update on storage.objects
 for each row execute function app_private.guard_screenshot_policy();
create trigger aa_screenshot_policy_write before insert on public.screenshots
 for each row execute function app_private.guard_screenshot_policy();
commit;
