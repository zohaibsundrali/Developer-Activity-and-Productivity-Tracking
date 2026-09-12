begin;
-- Advisory reminders default off; never pause or deduct tracked time automatically.
create table public.organization_idle_reminder_policies (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 enabled boolean not null default false,
 threshold_seconds integer not null default 300 check(threshold_seconds between 60 and 3600),
 updated_at timestamptz not null default now()
);
alter table public.organization_idle_reminder_policies enable row level security;
revoke all on public.organization_idle_reminder_policies from public,anon,authenticated;
grant select on public.organization_idle_reminder_policies to authenticated;
create policy idle_reminder_policy_tenant_read on public.organization_idle_reminder_policies for select to authenticated
 using(organization_id=public.auth_org());

create function public.can_manage_idle_reminder_policy() returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.auth_org() is not null
 and auth.jwt()->'app_metadata'->>'user_type'='admin'
 and public.auth_role() in ('owner','admin')
 and public.auth_override('organization.settings') is distinct from false
 and public.auth_override('organization.manage') is distinct from false;
$$;
revoke all on function public.can_manage_idle_reminder_policy() from public,anon,authenticated;
grant execute on function public.can_manage_idle_reminder_policy() to authenticated;

create function public.get_idle_reminder_policy() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare org uuid:=public.auth_org(); policy public.organization_idle_reminder_policies%rowtype;
begin
 if auth.uid() is null or org is null then raise exception 'IDLE_REMINDER_POLICY_UNAUTHORIZED' using errcode='42501'; end if;
 select * into policy from public.organization_idle_reminder_policies where organization_id=org;
 return jsonb_build_object('organization_id',org,'enabled',coalesce(policy.enabled,false),
 'threshold_seconds',coalesce(policy.threshold_seconds,300),'updated_at',policy.updated_at,
 'can_manage',coalesce(public.can_manage_idle_reminder_policy(),false));
end; $$;
revoke all on function public.get_idle_reminder_policy() from public,anon,authenticated;
grant execute on function public.get_idle_reminder_policy() to authenticated;

-- Definer is necessary for the single validated mutation; table writes are not
-- granted to API clients. No organization/id arguments can select another tenant.
create function public.set_idle_reminder_policy(p_enabled boolean,p_threshold_seconds integer) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,app_private as $$
declare org uuid:=public.auth_org();
begin
 if public.can_manage_idle_reminder_policy() is distinct from true then
  raise exception 'IDLE_REMINDER_POLICY_FORBIDDEN' using errcode='42501';
 end if;
 if p_enabled is null or p_threshold_seconds is null or p_threshold_seconds not between 60 and 3600 then
  raise exception 'IDLE_REMINDER_POLICY_INVALID' using errcode='22023';
 end if;
 perform app_private.lock_quota(org);
 -- Disabling reminders remains available when billing is locked.
 if p_enabled and not app_private.org_unlocked(org) then
  raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001';
 end if;
 insert into public.organization_idle_reminder_policies(organization_id,enabled,threshold_seconds)
 values(org,p_enabled,p_threshold_seconds)
 on conflict(organization_id) do update set enabled=excluded.enabled,
 threshold_seconds=excluded.threshold_seconds,updated_at=clock_timestamp();
 return public.get_idle_reminder_policy();
end; $$;
revoke all on function public.set_idle_reminder_policy(boolean,integer) from public,anon,authenticated;
grant execute on function public.set_idle_reminder_policy(boolean,integer) to authenticated;

commit;
