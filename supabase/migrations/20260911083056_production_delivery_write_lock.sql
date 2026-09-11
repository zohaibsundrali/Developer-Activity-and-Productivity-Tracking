begin;
-- Quotas govern increases; a subscription write lock governs every mutation.
-- Keep these separate so an unlocked, downgraded workspace can edit its data.
create or replace function app_private.guard_delivery_write_lock()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private as $$
declare organizations_to_check uuid[]; target_org uuid;
begin
  if tg_op = 'INSERT' then organizations_to_check := array[new.organization_id];
  elsif tg_op = 'DELETE' then organizations_to_check := array[old.organization_id];
  else organizations_to_check := array[old.organization_id, new.organization_id];
  end if;
  for target_org in select distinct org from unnest(organizations_to_check) org
    where org is not null order by org loop
    -- Cascaded organization cleanup must not recreate a quota-lock FK.
    if tg_op = 'DELETE' and not exists(select 1 from public.organizations where id=target_org) then
      continue;
    end if;
    perform app_private.lock_quota(target_org);
    if not app_private.org_unlocked(target_org) then
      raise exception 'BILLING_LOCKED: subscription requires attention' using errcode='P0001';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.guard_delivery_write_lock() from public;
create trigger delivery_write_lock before insert or update or delete on public.projects
for each row execute function app_private.guard_delivery_write_lock();
create trigger delivery_write_lock before insert or update or delete on public.developer_tasks
for each row execute function app_private.guard_delivery_write_lock();
commit;
