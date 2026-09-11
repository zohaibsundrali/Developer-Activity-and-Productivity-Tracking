-- Recovery ONLY for the five failed non-storage migrations reported on 2026-09-11.
-- Run the entire file once in Supabase SQL Editor as postgres.
-- Atomic: any error rolls back all five repairs. Already-applied versions must not be replayed.
-- Does not modify subscription status, delete data, or resolve unknown storage ownership.
begin;

-- SOURCE: 20260911095635_production_typed_notification_recipients.sql

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

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

-- SOURCE: 20260911102420_production_notification_recipient_state.sql

alter table public.notification_recipients
  add column read boolean not null default false,
  add column read_at timestamptz,
  add column dismissed_at timestamptz;
-- Historical rows had shared state. Preserve it for each recipient; it would
-- be fiction to infer which individual originally read or dismissed the row.
update public.notification_recipients r set read=coalesce(n.read,false),read_at=n.read_at,dismissed_at=n.dismissed_at
from public.notifications n where n.id=r.notification_id;
create index notification_recipients_unread_idx on public.notification_recipients(organization_id,user_type,user_id,notification_id)
where not read and dismissed_at is null;

create or replace function private.store_notification_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- New delivery always starts unread. A sender cannot mark a recipient's
  -- new notification read/dismissed through legacy INSERT fields.
  insert into public.notification_recipients(notification_id,organization_id,user_type,user_id,read,read_at,dismissed_at)
  select new.id,new.organization_id,split_part(k,':',1),split_part(k,':',2)::uuid,
    false,null,null from unnest(new.recipient_keys) k;
  return new;
end;
$$;
revoke all on function private.store_notification_identity() from public,anon,authenticated;

create or replace function private.guard_notification_recipient_state() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if (to_jsonb(new)-array['read','read_at','dismissed_at']) is distinct from
     (to_jsonb(old)-array['read','read_at','dismissed_at']) then
    raise exception 'Notification recipient identity is immutable' using errcode='42501';
  end if;
  -- Server timestamps, stable across retries; callers cannot backdate activity.
  if new.read then
    new.read_at:=case when old.read then old.read_at else clock_timestamp() end;
  else new.read_at:=null;
  end if;
  if new.dismissed_at is not null then
    new.dismissed_at:=coalesce(old.dismissed_at,clock_timestamp());
  end if;
  return new;
end;
$$;
revoke all on function private.guard_notification_recipient_state() from public,anon,authenticated;
create trigger guard_notification_recipient_state before update on public.notification_recipients
for each row execute function private.guard_notification_recipient_state();
grant update(read,read_at,dismissed_at) on public.notification_recipients to authenticated;
create policy notification_recipients_update_own on public.notification_recipients for update to authenticated
using (organization_id=public.auth_org() and user_id=public.auth_app_user_id()
 and user_type=auth.jwt()->'app_metadata'->>'user_type')
with check (organization_id=public.auth_org() and user_id=public.auth_app_user_id()
 and user_type=auth.jwt()->'app_metadata'->>'user_type');

-- A read-only projection: underlying notification and recipient RLS both run.
create view public.notification_inbox with (security_invoker=true) as
select n.id,n.organization_id,n.title,n.message,n.type,n.category,n.created_at,
 n.task_id,n.project_id,n.submission_id,n.entity_type,n.entity_id,n.actor_id,n.metadata,n.recipient_keys,
 r.user_id as recipient_user_id,r.user_type as recipient_user_type,r.read,r.read_at,r.dismissed_at
from public.notifications n join public.notification_recipients r on r.notification_id=n.id and r.organization_id=n.organization_id;
revoke all on public.notification_inbox from public,anon,authenticated;
grant select on public.notification_inbox to authenticated;
-- Legacy state stays as historical evidence, never as a writable shared inbox.
revoke update on public.notifications from authenticated;
create policy notifications_no_shared_state_update on public.notifications as restrictive for update to authenticated using(false) with check(false);

create function public.set_notification_state(p_notification uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_action is null or p_action not in ('read','unread','dismiss') or p_notification is null then
  raise exception 'Invalid notification state action' using errcode='22023';
 end if;
 update public.notification_recipients r set
  read=case p_action when 'read' then true when 'unread' then false else r.read end,
  dismissed_at=case p_action when 'dismiss' then coalesce(r.dismissed_at,clock_timestamp()) else r.dismissed_at end
 where r.notification_id=p_notification and r.organization_id=public.auth_org()
  and r.user_id=public.auth_app_user_id() and r.user_type=auth.jwt()->'app_metadata'->>'user_type'
 returning jsonb_build_object('read',r.read,'read_at',r.read_at,'dismissed_at',r.dismissed_at) into result;
 if not found then raise exception 'Notification not found' using errcode='P0002'; end if;
 return result;
end;
$$;
revoke all on function public.set_notification_state(uuid,text) from public,anon;
grant execute on function public.set_notification_state(uuid,text) to authenticated;

create function public.mark_notification_inbox_read(p_category text default null) returns bigint
language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed bigint;
begin
 update public.notification_recipients r set read=true
 from public.notifications n where n.id=r.notification_id and n.organization_id=r.organization_id
  and r.organization_id=public.auth_org() and r.user_id=public.auth_app_user_id()
  and r.user_type=auth.jwt()->'app_metadata'->>'user_type' and not r.read and r.dismissed_at is null
  and (p_category is null or n.category=p_category);
 get diagnostics changed=row_count;
 return changed;
end;
$$;
revoke all on function public.mark_notification_inbox_read(text) from public,anon;
grant execute on function public.mark_notification_inbox_read(text) to authenticated;

-- PostgreSQL change subscriptions need the recipient-state table as well as
-- notification content. Isolated test databases need not have this publication.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables)
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notification_recipients') then
  alter publication supabase_realtime add table public.notification_recipients;
 end if;
end $$;

-- SOURCE: 20260911113526_production_typed_project_ownership.sql

alter table public.projects add column created_by_type text check(created_by_type in ('admin','developer')),
 add column added_by_type text check(added_by_type in ('admin','developer')),
 add column manager_type text check(manager_type in ('admin','developer'));
create or replace function public.project_unique_identity_type(p_org uuid,p_reference text)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
 select min(m.user_type) from public.memberships m where m.organization_id=p_org and m.user_id::text=p_reference
  and m.user_type in ('admin','developer') having count(distinct m.user_type)=1;
$$;
revoke all on function public.project_unique_identity_type(uuid,text) from public,anon,authenticated;
grant execute on function public.project_unique_identity_type(uuid,text) to service_role;
-- Only the historical metadata backfill bypasses the delivery billing trigger.
-- The table lock prevents concurrent writes; DDL and backfill roll back together.
-- No runtime role, JWT claim, or session setting gains a billing bypass.
lock table public.projects in access exclusive mode;
do $backfill$
declare previous_state "char";
begin
 select tgenabled into previous_state from pg_trigger
 where tgrelid='public.projects'::regclass and tgname='delivery_write_lock' and not tgisinternal;
 if previous_state is not null then
  alter table public.projects disable trigger delivery_write_lock;
 end if;
update public.projects set created_by_type=public.project_unique_identity_type(organization_id,created_by::text),
 added_by_type=public.project_unique_identity_type(organization_id,added_by::text),
 manager_type=public.project_unique_identity_type(organization_id,manager_id::text);
 if previous_state in ('O','A','R') then
  execute 'alter table public.projects enable ' || case previous_state
   when 'A' then 'always ' when 'R' then 'replica ' else '' end || 'trigger delivery_write_lock';
 end if;
end $backfill$;

create or replace function public.project_actor_is_owner(p_org uuid,p_project uuid,p_user uuid,p_type text,p_allow_legacy boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_type in ('admin','developer') and exists(select 1 from public.memberships m where m.organization_id=p_org
  and m.user_id=p_user and m.user_type=p_type and m.status='active') and exists(
  select 1 from public.projects p where p.id=p_project and p.organization_id=p_org and (
   (p.created_by::text=p_user::text and coalesce(p.created_by_type,public.project_unique_identity_type(p_org,p.created_by::text))=p_type)
   or (p.added_by::text=p_user::text and coalesce(p.added_by_type,public.project_unique_identity_type(p_org,p.added_by::text))=p_type)
   or (p_allow_legacy and (
    (to_jsonb(p)->>'admin_id'=p_user::text and public.project_unique_identity_type(p_org,to_jsonb(p)->>'admin_id')=p_type)
    or exists(select 1 from public.memberships legacy where legacy.organization_id=p_org and legacy.user_id=p_user and legacy.user_type=p_type
      and nullif(lower(btrim(to_jsonb(p)->>'added_by_admin')),'')=lower(btrim(legacy.email))
      and (select count(*) from public.memberships matches where matches.organization_id=p_org and matches.user_type in ('admin','developer')
        and lower(btrim(matches.email))=lower(btrim(legacy.email)))=1)))));
$$;
revoke all on function public.project_actor_is_owner(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.project_actor_is_owner(uuid,uuid,uuid,text,boolean) to service_role;
create or replace function public.project_actor_is_manager(p_org uuid,p_project uuid,p_user uuid,p_type text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_type in ('admin','developer') and exists(select 1 from public.memberships m where m.organization_id=p_org
  and m.user_id=p_user and m.user_type=p_type and m.status='active') and exists(select 1 from public.projects p
   where p.id=p_project and p.organization_id=p_org and p.manager_id::text=p_user::text
    and coalesce(p.manager_type,public.project_unique_identity_type(p_org,p.manager_id::text))=p_type);
$$;
revoke all on function public.project_actor_is_manager(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.project_actor_is_manager(uuid,uuid,uuid,text) to service_role;

-- Delegation is scoped to the project's verified manager, assigned through the
-- protected manager workflow. It does not confer task.review or waive self-review.
create or replace function public.project_actor_can_review(p_org uuid,p_project uuid,p_user uuid,p_type text,p_allow_legacy boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.project_actor_is_owner(p_org,p_project,p_user,p_type,p_allow_legacy)
   or public.project_actor_is_manager(p_org,p_project,p_user,p_type);
$$;
revoke all on function public.project_actor_can_review(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.project_actor_can_review(uuid,uuid,uuid,text,boolean) to service_role;

create or replace function public.guard_project_typed_attribution()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare profile_type text; member_row public.memberships%rowtype; manager_profile text;
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 profile_type:=auth.jwt()->'app_metadata'->>'user_type';
 select * into member_row from public.memberships where organization_id=public.auth_org() and user_id=public.auth_app_user_id()
  and user_type=profile_type and status='active' and user_type in ('admin','developer');
 if not found or new.organization_id is distinct from public.auth_org() then
  raise exception 'Project attribution requires active staff identity' using errcode='42501'; end if;
 if tg_op='UPDATE' then
  if row(new.created_by_type,new.added_by_type,new.manager_type) is distinct from row(old.created_by_type,old.added_by_type,old.manager_type)
    or to_jsonb(new)->'admin_id' is distinct from to_jsonb(old)->'admin_id' then
   raise exception 'Project ownership types require the server workflow' using errcode='42501'; end if;
  return new;
 end if;
 -- Includes invoker clone_project: a clone's creator is the cloner. Source
 -- provenance remains in its clone activity record, not in ownership fields.
 new.created_by:=member_row.user_id; new.created_by_type:=profile_type;
 new.added_by:=member_row.user_id; new.added_by_type:=profile_type;
 new.added_by_admin:=member_row.email;
 -- Optional legacy column is an alternate owner path, not arbitrary metadata.
 new:=jsonb_populate_record(new,jsonb_build_object('admin_id',null));
 if new.manager_id is null then new.manager_type:=null;
 else
  if not coalesce(public.auth_override('project.assign_manager'),member_row.role in ('owner','admin'),false) then
   raise exception 'Project manager assignment permission required' using errcode='42501'; end if;
  if new.manager_type is null then
   select min(m.user_type) into manager_profile from public.memberships m where m.organization_id=new.organization_id
    and m.user_id=new.manager_id and m.user_type in ('admin','developer') having count(distinct m.user_type)=1;
   new.manager_type:=manager_profile;
  end if;
  if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=new.manager_id
   and m.user_type=new.manager_type and m.status='active' and m.role in ('owner','admin','manager','team_lead')) then
   raise exception 'Project manager must be an unambiguous active eligible staff identity' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_project_typed_attribution() from public;
create trigger project_typed_attribution before insert or update on public.projects for each row execute function public.guard_project_typed_attribution();

create or replace function public.commit_task_review(p_org uuid,p_reviewer uuid,p_profile_type text,p_email text,
  p_task uuid,p_submission uuid,p_action text,p_comments text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare member_row public.memberships%rowtype; task_row public.developer_tasks%rowtype;
  submission_row public.task_submissions%rowtype; project_row public.projects%rowtype;
  reviewed_time timestamptz:=now(); on_time boolean; score int; outcome text; totals record; percentage numeric;
begin
  if p_action not in ('approve','reject') or p_action is null or (p_action='reject' and nullif(btrim(p_reason),'') is null) then
    raise exception 'REVIEW_INVALID: action and rejection reason are required' using errcode='22023';
  end if;
  if p_profile_type not in ('admin','developer') or p_profile_type is null then
    raise exception 'REVIEW_FORBIDDEN: staff profile required' using errcode='42501';
  end if;
  perform app_private.lock_quota(p_org);
  select * into member_row from public.memberships where organization_id=p_org and user_id=p_reviewer
    and user_type=p_profile_type and status='active' for share;
  if not found or not coalesce((select allowed from public.user_permissions where membership_id=member_row.id
    and permission_key='task.review'),member_row.role in ('owner','admin','manager','team_lead','qa'),false) then
    raise exception 'REVIEW_FORBIDDEN: reviewer permission required' using errcode='42501';
  end if;
  if not app_private.org_unlocked(p_org) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
  select * into task_row from public.developer_tasks where id=p_task and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: task not found' using errcode='P0002'; end if;
  select * into project_row from public.projects where id=task_row.project_id and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: project not found' using errcode='P0002'; end if;
  if not public.project_actor_can_review(p_org,task_row.project_id,p_reviewer,p_profile_type,false) then
    raise exception 'REVIEW_FORBIDDEN: project ownership or assigned manager authority required' using errcode='42501';
  end if;
  select * into submission_row from public.task_submissions where id=p_submission and organization_id=p_org for update;
  if not found then raise exception 'REVIEW_NOT_FOUND: submission not found' using errcode='P0002'; end if;
  if submission_row.task_id is distinct from p_task then raise exception 'REVIEW_INVALID: mismatched task' using errcode='22023'; end if;
  if p_profile_type='developer' and (p_reviewer=task_row.developer_id or p_reviewer=submission_row.developer_id) then
    raise exception 'REVIEW_FORBIDDEN: cannot review your own work' using errcode='42501';
  end if;
  -- Reassignment/project moves can happen after proof was submitted. Never
  -- award the current assignee points for another person's or project's proof.
  if submission_row.developer_id is distinct from task_row.developer_id
    or submission_row.project_id is distinct from task_row.project_id then
    raise exception 'REVIEW_CONFLICT: submission no longer matches task assignment or project';
  end if;
  if task_row.status in ('completed','rejected') or submission_row.review_status is distinct from 'pending' or coalesce(submission_row.is_reviewed,false) then
    raise exception 'REVIEW_CONFLICT: work has already been reviewed';
  end if;
  if task_row.end_date is null or submission_row.submitted_at is null then
    raise exception 'REVIEW_INVALID: deadline and submission time are required' using errcode='22023';
  end if;
  on_time := (submission_row.submitted_at at time zone 'UTC')::date <= task_row.end_date::date;
  outcome := case when p_action='approve' then 'completed' else 'rejected' end;
  score := case when p_action='reject' then 0 when on_time then 1 else -1 end;
  update public.developer_tasks set status=outcome,is_on_time=case when p_action='approve' then on_time else null end,
    productivity_points=score,actual_completion_date=case when p_action='approve' then (reviewed_time at time zone 'UTC')::date else null end,
    reviewed_by=p_reviewer,reviewed_at=reviewed_time,admin_comments=p_comments,
    rejection_reason=case when p_action='reject' then p_reason else null end,updated_at=reviewed_time where id=p_task;
  update public.task_submissions set is_reviewed=true,reviewed_by=p_reviewer,reviewed_at=reviewed_time,
    review_status=case when p_action='approve' then 'approved' else 'rejected' end,
    review_comments=case when p_action='approve' then p_comments else p_reason end where id=p_submission;
  insert into public.admin_reviews(organization_id,admin_id,admin_email,admin_name,task_id,submission_id,project_id,developer_id,
    review_action,review_comments,rejection_reason,task_title,submission_file_url,deadline,submission_date,reviewed_at)
  values(p_org,p_reviewer,p_email,p_email,p_task,p_submission,task_row.project_id,task_row.developer_id,
    case when p_action='approve' then 'approved' else 'rejected' end,p_comments,p_reason,task_row.task_title,
    submission_row.file_url,task_row.end_date,submission_row.submitted_at,reviewed_time);
  insert into public.activity_logs(organization_id,developer_id,project_id,task_id,action_type,action_description,old_value,new_value)
  values(p_org,task_row.developer_id,task_row.project_id,p_task,
    case when p_action='approve' then 'task_approved' else 'task_rejected' end,
    format('Task "%s" %s by reviewer',task_row.task_title,outcome),task_row.status,outcome);
  select count(*) total,count(*) filter(where status='completed' and is_on_time=true) timely,
    count(*) filter(where status='completed' and is_on_time=false) late,
    count(*) filter(where status in ('pending','in_progress','awaiting_approval')) pending,
    count(*) filter(where status='rejected') rejected into totals
    from public.developer_tasks where organization_id=p_org and project_id=task_row.project_id and developer_id=task_row.developer_id;
  percentage:=round(greatest(0,least(100,(totals.timely-totals.late+totals.pending*0.5)*100/nullif(totals.total,0))),2);
  insert into public.productivity_metrics(organization_id,developer_id,project_id,total_tasks,completed_on_time,completed_late,
    pending_tasks,rejected_tasks,productivity_percentage,productivity_points,updated_at)
  values(p_org,task_row.developer_id,task_row.project_id,totals.total,totals.timely,totals.late,totals.pending,totals.rejected,
    percentage,totals.timely-totals.late,reviewed_time)
  on conflict(developer_id,project_id) do update set organization_id=excluded.organization_id,total_tasks=excluded.total_tasks,
    completed_on_time=excluded.completed_on_time,completed_late=excluded.completed_late,pending_tasks=excluded.pending_tasks,
    rejected_tasks=excluded.rejected_tasks,productivity_percentage=excluded.productivity_percentage,
    productivity_points=excluded.productivity_points,updated_at=excluded.updated_at;
  -- Project totals include every assignee, not just the person reviewed last.
  select count(*) total,count(*) filter(where status='completed' and is_on_time=true) timely,
    count(*) filter(where status='completed' and is_on_time=false) late,
    count(*) filter(where status in ('pending','in_progress','awaiting_approval')) pending into totals
    from public.developer_tasks where organization_id=p_org and project_id=task_row.project_id;
  update public.projects set total_tasks_count=totals.total,completed_tasks_count=totals.timely+totals.late,
    total_productivity_score=round(greatest(0,least(100,(totals.timely-totals.late+totals.pending*0.5)*100/nullif(totals.total,0))),2),
    progress=round((totals.timely+totals.late)*100.0/nullif(totals.total,0)),updated_at=reviewed_time where id=task_row.project_id;
  insert into public.notifications(organization_id,developer_id,admin_id,admin_recipient_type,type,title,message,project_id,task_id,submission_id,read)
  values(p_org,task_row.developer_id,p_reviewer,p_profile_type,
    case when p_action='approve' then 'task_approved' else 'task_rejected' end,
    case when p_action='approve' then 'Task Approved' else 'Task Rejected' end,
    case when p_action='approve' then format('Your task "%s" has been approved! %s',task_row.task_title,
      case when on_time then '(Completed on time - +1 point)' else '(Completed late - -1 point)' end)
      else format('Your task "%s" was rejected. Reason: %s',task_row.task_title,p_reason) end,
    task_row.project_id,p_task,p_submission,false);
  return jsonb_build_object('success',true,'message',format('Task %s successfully',outcome),
    'task',jsonb_build_object('id',p_task,'status',outcome,'is_on_time',on_time,'productivity_points',score));
end;
$$;
revoke all on function public.commit_task_review(uuid,uuid,text,text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.commit_task_review(uuid,uuid,text,text,uuid,uuid,text,text,text) to service_role;

create or replace function public.task_watcher_reviewer_eligible(p_org uuid,p_task uuid,p_user uuid,p_type text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_type in ('admin','developer') and exists(
  select 1 from public.memberships m join public.developer_tasks t on t.id=p_task and t.organization_id=m.organization_id
   join public.projects p on p.id=t.project_id and p.organization_id=m.organization_id
  where m.organization_id=p_org and m.user_id=p_user and m.user_type=p_type and m.status='active'
   and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),
     m.role in ('owner','admin','manager','team_lead','qa'),false)
   and public.project_actor_can_review(p_org,p.id,p_user,p_type,false)
   and (p_type<>'developer' or t.developer_id is distinct from p_user)
   and not exists(select 1 from public.task_submissions s where s.organization_id=p_org and s.task_id=p_task
     and s.review_status='pending' and s.developer_id=p_user and p_type='developer')
);
$$;
revoke all on function public.task_watcher_reviewer_eligible(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.task_watcher_reviewer_eligible(uuid,uuid,uuid,text) to service_role;


create or replace function public.clone_project(p_source uuid,p_name text,p_copy_tasks boolean default true)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare source_project public.projects%rowtype; cloned_project public.projects%rowtype; cloned_task public.developer_tasks%rowtype;
 source_tasks jsonb:='[]'; task_ids jsonb:='{}'; item record; payload jsonb; parent_id text; cloned_count int:=0;
 clone_id uuid:=gen_random_uuid(); org uuid:=public.auth_org(); today date:=(now() at time zone 'UTC')::date;
begin
 if org is null or not coalesce(public.auth_project_mutation('project.create'),false) then
   raise exception 'CLONE_FORBIDDEN: project creation permission required' using errcode='42501'; end if;
 if not public.auth_org_unlocked() then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
 -- Capture source configuration and visible tasks in one statement snapshot.
 -- FOR SHARE would also require the source project UPDATE policy (project.hub),
 -- accidentally denying an otherwise valid create grant plus read access.
 select to_jsonb(p) project,case when coalesce(p_copy_tasks,true) then
   (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.developer_tasks t
     where t.project_id=p.id and t.organization_id=org) else '[]'::jsonb end tasks
   into item from public.projects p where p.id=p_source and p.organization_id=org;
 if not found then raise exception 'CLONE_NOT_FOUND: source project not found' using errcode='P0002'; end if;
 source_project:=jsonb_populate_record(null::public.projects,item.project);
 source_tasks:=item.tasks;
 if coalesce(p_copy_tasks,true) then
   for item in select value from jsonb_array_elements(source_tasks) loop
     task_ids:=task_ids||jsonb_build_object(item.value->>'id',gen_random_uuid());
   end loop;
 end if;
 payload:=to_jsonb(source_project)-array['id','created_at','updated_at','name','status','progress',
   'total_tasks_count','completed_tasks_count','total_productivity_score','task_plan_submitted','task_plan_status',
   'task_plan_submitted_at','task_plan_reviewed_at','task_plan_reviewed_by','task_plan_rejection_reason',
   'completed_at','completed_by','client_signed_off_at','client_rating','client_feedback','closed_at','closed_by','closure_note'];
 payload:=payload||jsonb_build_object('id',clone_id,'organization_id',org,'name',coalesce(nullif(btrim(p_name),''),source_project.name||' (copy)'),
   'status','pending','progress',0,'total_tasks_count',0,'completed_tasks_count',0,'total_productivity_score',0,
   'task_plan_submitted',false,'task_plan_status','draft','is_template',false,'archived',false,'created_at',now(),'updated_at',now());
 -- A creator without manager-assignment authority cannot carry that authority
 -- into a new project through the generic source configuration copy.
 if not coalesce(public.auth_override('project.assign_manager'),public.auth_role() in ('owner','admin'),false) then
  payload:=payload||jsonb_build_object('manager_id',null,'manager_type',null);
 end if;
 cloned_project:=jsonb_populate_record(null::public.projects,payload);
 insert into public.projects select cloned_project.* returning * into cloned_project;
 -- Parents first. A parent outside the caller's copied snapshot is detached;
 -- it must never remain an edge back into the original or an invisible project.
 for item in
   with recursive source as (select value,value->>'id' id,value->>'parent_task_id' parent from jsonb_array_elements(source_tasks)),
   tree as (
     select s.value,s.id,0 depth from source s where s.parent is null or not task_ids?s.parent
     union all
     select child.value,child.id,tree.depth+1 from source child join tree on child.parent=tree.id
   ) select value from tree order by depth,id
 loop
   payload:=item.value-array['id','created_at','updated_at','submitted_at','reviewed_at','reviewed_by',
     'actual_completion_date','admin_comments','rejection_reason','is_on_time','productivity_points'];
   parent_id:=item.value->>'parent_task_id';
   payload:=payload||jsonb_build_object('id',task_ids->>(item.value->>'id'),'organization_id',org,'project_id',clone_id,
     'parent_task_id',task_ids->>parent_id,'status','pending','client_visible',false,'productivity_points',0,
     'start_date',coalesce(item.value->>'start_date',today::text),'end_date',coalesce(item.value->>'end_date',today::text),
     'created_at',now(),'updated_at',now());
   -- This feature clones projects and tasks, not their sprint/epic containers.
   -- Organization-wide open containers remain usable; project-owned or closed
   -- containers are deliberately detached from the new project.
   if not exists(select 1 from public.sprints where id=(payload->>'sprint_id')::uuid and organization_id=org
      and project_id is null and status is distinct from 'completed') then payload:=payload||'{"sprint_id":null}'; end if;
   if not exists(select 1 from public.epics where id=(payload->>'epic_id')::uuid and organization_id=org
      and project_id is null) then payload:=payload||'{"epic_id":null}'; end if;
   cloned_task:=jsonb_populate_record(null::public.developer_tasks,payload);
   insert into public.developer_tasks select cloned_task.*;
   cloned_count:=cloned_count+1;
 end loop;
 if cloned_count<>jsonb_array_length(source_tasks) then raise exception 'CLONE_INVALID: source task hierarchy contains a cycle' using errcode='22023'; end if;
 return jsonb_build_object('project',to_jsonb(cloned_project),'tasks',cloned_count);
end $$;
revoke all on function public.clone_project(uuid,text,boolean) from public,anon;
grant execute on function public.clone_project(uuid,text,boolean) to authenticated;


-- SOURCE: 20260911123702_production_typed_project_manager_roster.sql

-- A project roster identity is the typed profile, not an interchangeable UUID.
alter table public.project_members drop constraint project_members_unique;
alter table public.project_members add constraint project_members_unique unique(project_id,user_id,user_type);
create or replace function public.projects_sync_manager_member()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_type text;
begin
 target_type:=coalesce(new.manager_type,public.project_unique_identity_type(new.organization_id,new.manager_id::text));
 if new.manager_id is not null and not exists(select 1 from public.memberships m
  where m.organization_id=new.organization_id and m.user_id=new.manager_id and m.user_type=target_type
   and m.status='active' and m.role in ('owner','admin','manager','team_lead')) then
  raise exception 'Project manager requires an active, unambiguous typed manager membership' using errcode='23514';
 end if;
 -- Retain former managers as collaborators, including a different profile
 -- sharing the newly assigned manager UUID. Do not overwrite identity/allocation.
 update public.project_members set project_role='developer',updated_at=now()
 where project_id=new.id and organization_id=new.organization_id and project_role='manager'
  and (new.manager_id is null or (user_id,user_type) is distinct from (new.manager_id,target_type));
 if new.manager_id is not null then
  insert into public.project_members(organization_id,project_id,user_id,user_type,project_role)
  values(new.organization_id,new.id,new.manager_id,target_type,'manager')
  on conflict(project_id,user_id,user_type) do update set project_role='manager',updated_at=now();
 end if;
 return new;
end $$;
revoke all on function public.projects_sync_manager_member() from public,anon,authenticated;
drop trigger if exists trg_projects_sync_manager_member on public.projects;
create trigger trg_projects_sync_manager_member after insert or update of manager_id,manager_type on public.projects
 for each row execute function public.projects_sync_manager_member();
-- Enforce the authoritative manager pointer even for service writes. Lock the
-- parent to serialize reassignment with roster mutation; conflicting lock orders
-- can abort/retry rather than permitting a stale authorization check to commit.
create or replace function public.guard_project_manager_roster()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.projects%rowtype; manager_profile text; target_project uuid;
begin
 if tg_op='UPDATE' and (new.organization_id,new.project_id,new.user_id,new.user_type) is distinct from (old.organization_id,old.project_id,old.user_id,old.user_type) then
  raise exception 'Project roster identity is immutable' using errcode='23514';
 end if;
 if tg_op='DELETE' then target_project:=old.project_id; else target_project:=new.project_id; end if;
 select * into p from public.projects where id=target_project for update;
 if not found then
  if tg_op='DELETE' then return old; end if;
  raise exception 'Project is required for roster writes' using errcode='23514';
 end if;
 manager_profile:=coalesce(p.manager_type,public.project_unique_identity_type(p.organization_id,p.manager_id::text));
 if tg_op in ('DELETE','UPDATE') then
  if old.organization_id=p.organization_id and old.user_id=p.manager_id and old.user_type=manager_profile then
   if tg_op='DELETE' then raise exception 'Reassign the project manager before removing this member' using errcode='23514'; end if;
   if new.project_role<>'manager' or (new.organization_id,new.project_id,new.user_id,new.user_type)
    is distinct from (old.organization_id,old.project_id,old.user_id,old.user_type) then
    raise exception 'Reassign the project manager before changing this membership' using errcode='23514';
   end if;
  end if;
 end if;
 if tg_op<>'DELETE' and new.project_role='manager' then
  if tg_op='INSERT' or (new.project_role,new.organization_id,new.project_id,new.user_id,new.user_type)
   is distinct from (old.project_role,old.organization_id,old.project_id,old.user_id,old.user_type) then
   if not coalesce(new.organization_id=p.organization_id and new.user_id=p.manager_id and new.user_type=manager_profile,false) then
    raise exception 'Assign the project manager through the project workflow' using errcode='23514';
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.guard_project_manager_roster() from public,anon,authenticated;
create trigger project_manager_roster before insert or update or delete on public.project_members
 for each row execute function public.guard_project_manager_roster();
-- Repair authoritative, currently eligible historical manager mappings only.
-- Ambiguous/inactive legacy assignments require explicit reassignment.
-- Only the historical metadata backfill bypasses the delivery billing trigger.
-- The table lock prevents concurrent writes; DDL and backfill roll back together.
-- No runtime role, JWT claim, or session setting gains a billing bypass.
lock table public.projects in access exclusive mode;
do $backfill$
declare previous_state "char";
begin
 select tgenabled into previous_state from pg_trigger
 where tgrelid='public.projects'::regclass and tgname='delivery_write_lock' and not tgisinternal;
 if previous_state is not null then
  alter table public.projects disable trigger delivery_write_lock;
 end if;
update public.projects p set manager_type=coalesce(p.manager_type,public.project_unique_identity_type(p.organization_id,p.manager_id::text))
where p.manager_id is not null and exists(select 1 from public.memberships m
 where m.organization_id=p.organization_id and m.user_id=p.manager_id
  and m.user_type=coalesce(p.manager_type,public.project_unique_identity_type(p.organization_id,p.manager_id::text))
  and m.status='active' and m.role in ('owner','admin','manager','team_lead'));
 if previous_state in ('O','A','R') then
  execute 'alter table public.projects enable ' || case previous_state
   when 'A' then 'always ' when 'R' then 'replica ' else '' end || 'trigger delivery_write_lock';
 end if;
end $backfill$;

-- SOURCE: 20260911133042_production_transactional_task_assignment_notifications.sql

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Membership authority is evaluated for the actual old/new typed assignee,
-- never IDs supplied as notification metadata.
create or replace function private.assignment_notice_recipient(p_org uuid,p_user uuid,p_kind text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.memberships m where m.organization_id=p_org and m.user_id=p_user
  and m.user_type='developer' and m.status='active' and m.role<>'client' and (
  coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_own'),m.role in ('owner','admin','manager','hr','finance','team_lead','qa','developer','designer','devops','employee'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.view_all'),m.role in ('owner','admin','manager','team_lead'),false)
  or coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='task.review'),m.role in ('owner','admin','manager','team_lead','qa'),false)
  or (p_kind='bug' and coalesce((select allowed from public.user_permissions where membership_id=m.id and permission_key='bug.triage'),m.role in ('owner','admin','manager','team_lead','qa'),false))));
$$;
revoke all on function private.assignment_notice_recipient(uuid,uuid,text) from public,anon,authenticated;
create or replace function public.notify_task_assignment_transaction()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare previous_id uuid; actor uuid; actor_profile text; previous_title text; event_type text;
begin
 if tg_op='UPDATE' then
  if new.developer_id is not distinct from old.developer_id then return new; end if;
  previous_id:=old.developer_id;
  previous_title:=coalesce(nullif(old.task_title,''),'A task');
 end if;
 actor:=public.auth_app_user_id(); actor_profile:=auth.jwt()->'app_metadata'->>'user_type';
 if not exists(select 1 from public.memberships m where m.organization_id=new.organization_id and m.user_id=actor
  and m.user_type=actor_profile and m.user_type in ('admin','developer') and m.status='active' and m.role<>'client') then
  actor:=null; actor_profile:=null;
 end if;
 if new.developer_id is not null and private.assignment_notice_recipient(new.organization_id,new.developer_id,new.task_type)
  and not coalesce(actor_profile='developer' and actor=new.developer_id,false) then
  event_type:=case when previous_id is null then 'task_assigned' else 'task_reassigned' end;
  insert into public.notifications(organization_id,developer_id,type,category,title,message,task_id,project_id,actor_id,actor_type,metadata,read)
  values(new.organization_id,new.developer_id,event_type,'assignment','Task assigned to you',
   format('You have been assigned "%s".',coalesce(nullif(new.task_title,''),'a task')),new.id,new.project_id,actor,actor_profile,
   jsonb_build_object('taskTitle',new.task_title),false);
 end if;
 if previous_id is not null and private.assignment_notice_recipient(old.organization_id,previous_id,old.task_type)
  and not coalesce(actor_profile='developer' and actor=previous_id,false) then
  -- The old assignee may lose parent access immediately. Keep only their OLD
  -- title snapshot; no current task/project link or successor identity leaks.
  event_type:=case when new.developer_id is null then 'task_unassigned' else 'task_reassigned_away' end;
  insert into public.notifications(organization_id,developer_id,type,category,title,message,actor_id,actor_type,metadata,read)
  values(old.organization_id,previous_id,event_type,'assignment','Task assignment removed',
   format('"%s" is no longer assigned to you.',previous_title),actor,actor_profile,jsonb_build_object('taskTitle',previous_title),false);
 end if;
 return new;
end $$;
revoke all on function public.notify_task_assignment_transaction() from public,anon,authenticated;
create trigger task_assignment_notification after insert or update of developer_id on public.developer_tasks
 for each row execute function public.notify_task_assignment_transaction();
-- Browser writes cannot fabricate authoritative assignment/removal events.
create or replace function public.guard_assignment_notice_insert() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if current_user not in ('postgres','supabase_admin','service_role')
  and new.type in ('task_assigned','task_reassigned','task_reassigned_away','task_unassigned') then
  raise exception 'Assignment notifications require the task assignment transaction' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_assignment_notice_insert() from public,anon,authenticated;
create trigger ab_assignment_notice_authority before insert on public.notifications
 for each row execute function public.guard_assignment_notice_insert();


-- Billing enforcement must be restored before committing.
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.projects'::regclass and tgname='delivery_write_lock' and tgenabled in ('O','A')) then
  raise exception 'RECOVERY_ABORTED: projects billing trigger is not enabled';
 end if;
end $$;
commit;
