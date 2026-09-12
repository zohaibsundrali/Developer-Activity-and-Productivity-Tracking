begin;
-- Reservations precede their organizations, so signup_attempts cannot have an
-- ordinary organization FK. Remove completed reservation PII only when the
-- actual organization DELETE commits. Pending recovery is intentionally kept.
create function app_private.cleanup_completed_signup() returns trigger
language plpgsql security definer set search_path=pg_catalog,app_private as $$
begin
 delete from app_private.signup_attempts
 where organization_id=old.id and completed_at is not null;
 return old;
end $$;
revoke all on function app_private.cleanup_completed_signup() from public,anon,authenticated,service_role;
create trigger aaa_completed_signup_cleanup after delete on public.organizations
for each row execute function app_private.cleanup_completed_signup();
commit;
