begin;
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
commit;
