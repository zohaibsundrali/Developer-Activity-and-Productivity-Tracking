begin;
alter table public.notifications add column admin_recipient_type text
  check (admin_recipient_type in ('admin','developer'));
alter table public.notifications add column recipient_keys text[] not null default '{}';
create index notifications_recipient_keys_idx on public.notifications using gin(recipient_keys);

-- Membership identities, not dashboard audiences. Keep legacy address columns
-- while writers roll forward; a notification can still have several recipients.
create table public.notification_recipients (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  user_type text not null check (user_type in ('admin','developer')),
  primary key(notification_id,user_type,user_id)
);
create index notification_recipients_inbox_idx on public.notification_recipients(organization_id,user_type,user_id,notification_id);
alter table public.notification_recipients enable row level security;
revoke all on public.notification_recipients from public, anon, authenticated;
grant select on public.notification_recipients to authenticated;
grant all on public.notification_recipients to service_role;
create policy notification_recipients_own on public.notification_recipients for select to authenticated
using (organization_id=public.auth_org() and user_id=public.auth_app_user_id()
  and user_type=auth.jwt()->'app_metadata'->>'user_type');

create or replace function private.notification_recipient_keys(p_org uuid,p_admin text,p_email text,p_type text,p_developer uuid,p_assigned uuid,p_strict boolean)
returns text[] language plpgsql stable security definer set search_path=public,pg_temp as $$
declare keys text[] := '{}'; candidates text[]; requested uuid; key text; address_present boolean;
begin
  -- Definer is necessary to resolve other recipients' membership rows; this
  -- private function is not callable by application roles.
  for requested in select distinct x from unnest(array[p_developer,p_assigned]) x where x is not null loop
    if exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=requested and m.user_type='developer'
      and (not p_strict or m.status='active')) then
      keys:=array_append(keys,'developer:'||requested::text);
    elsif p_strict then raise exception 'NOTIFICATION_RECIPIENT_INVALID: recipient must be active staff in this organization' using errcode='22023';
    end if;
  end loop;
  address_present := nullif(btrim(p_admin),'') is not null or nullif(btrim(p_email),'') is not null;
  if address_present then
    -- ID and email must corroborate the same person. Never OR them to silently
    -- add an unrelated recipient, and never guess the type of a colliding ID.
    select array_agg(distinct m.user_type||':'||m.user_id::text) into candidates
    from public.memberships m where m.organization_id=p_org and m.user_type in ('admin','developer')
      and (not p_strict or m.status='active')
      and (p_type is null or m.user_type=p_type)
      and (nullif(btrim(p_admin),'') is null or m.user_id::text=btrim(p_admin))
      and (nullif(btrim(p_email),'') is null or lower(btrim(m.email))=lower(btrim(p_email)));
    if cardinality(candidates)=1 then keys:=keys||candidates;
    elsif p_strict then raise exception 'Notification recipient cannot be resolved. Repair the project creator membership or supply the verified admin_recipient_type.' using errcode='22023';
    end if;
  end if;
  select coalesce(array_agg(distinct x order by x),'{}') into keys from unnest(keys) x;
  return keys;
end;
$$;
revoke all on function private.notification_recipient_keys(uuid,text,text,text,uuid,uuid,boolean) from public,anon,authenticated;

-- Backfill never guesses ambiguous legacy identities, never deletes history,
-- and does not apply today's mute preferences to yesterday's notifications.
update public.notifications n set recipient_keys=private.notification_recipient_keys(
  n.organization_id,n.admin_id,n.admin_email,n.admin_recipient_type,n.developer_id,n.assigned_developer_id,false);
insert into public.notification_recipients(notification_id,organization_id,user_type,user_id)
select n.id,n.organization_id,split_part(k,':',1),split_part(k,':',2)::uuid
from public.notifications n cross join lateral unnest(n.recipient_keys) k;

-- Previously one profile could overwrite the other profile's preference when
-- their UUIDs collided. Preserve existing rows with their recorded type.
drop index if exists public.uq_notification_prefs_user_category;
create unique index uq_notification_prefs_identity_category on public.notification_preferences(organization_id,user_type,user_id,category);
drop policy if exists notification_prefs_own on public.notification_preferences;
create policy notification_prefs_own on public.notification_preferences for all to authenticated
using (organization_id=public.auth_org() and user_id=public.auth_app_user_id()
  and user_type=auth.jwt()->'app_metadata'->>'user_type' and user_type in ('admin','developer'))
with check (organization_id=public.auth_org() and user_id=public.auth_app_user_id()
  and user_type=auth.jwt()->'app_metadata'->>'user_type' and user_type in ('admin','developer'));
create policy notification_prefs_typed on public.notification_preferences as restrictive for all to authenticated
using (organization_id=public.auth_org() and user_id=public.auth_app_user_id()
  and user_type=auth.jwt()->'app_metadata'->>'user_type' and user_type in ('admin','developer'))
with check (organization_id=public.auth_org() and user_id=public.auth_app_user_id()
  and user_type=auth.jwt()->'app_metadata'->>'user_type' and user_type in ('admin','developer'));

-- Normalize before category derivation/muting (Postgres orders same-event
-- triggers by name). Supplied recipient_keys are always replaced.
create or replace function private.prepare_notification_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  new.recipient_keys:=private.notification_recipient_keys(new.organization_id,new.admin_id,new.admin_email,
    new.admin_recipient_type,new.developer_id,new.assigned_developer_id,true);
  if cardinality(new.recipient_keys)=0 then
    raise exception 'NOTIFICATION_RECIPIENT_REQUIRED: provide a verified staff recipient' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_notification_identity() from public,anon,authenticated;
create trigger aaa_notification_identity before insert on public.notifications
for each row execute function private.prepare_notification_identity();

create or replace function public.apply_notification_preference() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Remove only muted recipients. One person's preference must not suppress
  -- another person's copy of a multi-recipient event.
  select coalesce(array_agg(k order by k),'{}') into new.recipient_keys from unnest(new.recipient_keys) k
  where not exists(select 1 from public.notification_preferences p
    where p.organization_id=new.organization_id and p.user_type=split_part(k,':',1)
      and p.user_id=split_part(k,':',2)::uuid and p.category=new.category and not p.enabled);
  if cardinality(new.recipient_keys)=0 then return null; end if;
  return new;
end;
$$;
revoke all on function public.apply_notification_preference() from public,anon,authenticated;
drop trigger if exists trg_apply_notification_preference on public.notifications;
create trigger zzz_apply_notification_preference before insert on public.notifications
for each row execute function public.apply_notification_preference();

create or replace function private.store_notification_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.notification_recipients(notification_id,organization_id,user_type,user_id)
  select new.id,new.organization_id,split_part(k,':',1),split_part(k,':',2)::uuid from unnest(new.recipient_keys) k;
  return new;
end;
$$;
revoke all on function private.store_notification_identity() from public,anon,authenticated;
create trigger store_notification_identity after insert on public.notifications
for each row execute function private.store_notification_identity();

-- Application/service UPDATEs must not stale the canonical recipients. Read
-- state and legacy content maintenance continue through existing update rules.
create or replace function private.guard_notification_identity() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if row(new.organization_id,new.admin_id,new.admin_email,new.admin_recipient_type,new.developer_id,new.assigned_developer_id,new.recipient_keys)
    is distinct from row(old.organization_id,old.admin_id,old.admin_email,old.admin_recipient_type,old.developer_id,old.assigned_developer_id,old.recipient_keys) then
    raise exception 'Notification recipients are immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_notification_identity() from public,anon,authenticated;
create trigger aaa_guard_notification_identity before update on public.notifications
for each row execute function private.guard_notification_identity();

create or replace function public.notification_is_typed_recipient(p_keys text[]) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
  select coalesce(auth.jwt()->'app_metadata'->>'user_type' in ('admin','developer')
    and ((auth.jwt()->'app_metadata'->>'user_type')||':'||public.auth_app_user_id()::text)=any(p_keys),false);
$$;
revoke all on function public.notification_is_typed_recipient(text[]) from public,anon;
grant execute on function public.notification_is_typed_recipient(text[]) to authenticated;
drop policy if exists notifications_read on public.notifications;
drop policy if exists notifications_update on public.notifications;
drop policy if exists notifications_recipient_select on public.notifications;
drop policy if exists notifications_recipient_update on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
using (organization_id=public.auth_org() and public.notification_is_typed_recipient(recipient_keys));
create policy notifications_update on public.notifications for update to authenticated
using (organization_id=public.auth_org() and public.notification_is_typed_recipient(recipient_keys))
with check (organization_id=public.auth_org() and public.notification_is_typed_recipient(recipient_keys));
create policy notifications_recipient_select on public.notifications as restrictive for select to authenticated
using (organization_id=public.auth_org() and public.notification_is_typed_recipient(recipient_keys));
create policy notifications_recipient_update on public.notifications as restrictive for update to authenticated
using (organization_id=public.auth_org() and public.notification_is_typed_recipient(recipient_keys))
with check (organization_id=public.auth_org() and public.notification_is_typed_recipient(recipient_keys));
-- No product flow deletes inbox history through the browser. In particular,
-- one recipient must not delete a multi-recipient event for everybody else.
create policy notifications_no_browser_delete on public.notifications as restrictive for delete to authenticated using(false);
commit;
