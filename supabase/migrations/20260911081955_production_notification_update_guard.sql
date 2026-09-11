begin;
create or replace function public.guard_notification_update()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  -- Trust database roles, never the caller's application role or JWT field.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  -- Protect future columns as well as today's content and recipient fields.
  if (to_jsonb(new) - array['read', 'read_at']) is distinct from
     (to_jsonb(old) - array['read', 'read_at']) then
    raise exception 'A notification recipient may only change read state'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_notification_update on public.notifications;
create trigger trg_guard_notification_update before update on public.notifications
for each row execute function public.guard_notification_update();
commit;
