begin;
-- These types are written exclusively by verified proposal, client approval,
-- and manager assignment routes. A readable reference is not authority to
-- announce that the underlying business decision happened.
create function public.guard_server_notification_event() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if current_user not in ('postgres','supabase_admin','service_role')
  and new.type in ('proposal_submitted','client_approved','client_changes_requested','project_manager_assigned') then
  raise exception 'Notification event requires its authoritative server workflow' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_server_notification_event() from public,anon,authenticated;
create trigger ab_server_notification_event before insert on public.notifications
 for each row execute function public.guard_server_notification_event();
commit;
