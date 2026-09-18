begin;

-- Server-only preflight for the same identities claim_signup will reject.
-- Definer access is restricted to service_role so the browser cannot inspect
-- auth identities or private recovery reservations. No rows or IDs are exposed.
create function public.signup_email_status(p_email text) returns text
language plpgsql stable security definer set search_path = pg_catalog as $$
declare address text := lower(btrim(p_email));
begin
  if address is null or length(address)>254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'SIGNUP_INVALID';
  end if;
  -- A reserved, unfinished signup may have already created its Auth identity.
  -- It must still be able to obtain fresh verification and resume safely.
  if exists(select 1 from app_private.signup_attempts where email=address and completed_at is null) then
    return 'resumable';
  end if;
  if exists(select 1 from public.admin_users where lower(btrim(email))=address) then
    return 'admin_exists';
  end if;
  if exists(select 1 from public.developers where lower(btrim(email))=address)
    or exists(select 1 from public.clients where lower(btrim(email))=address)
    or exists(select 1 from public.memberships where lower(btrim(email))=address)
    or exists(select 1 from auth.users where lower(btrim(email))=address) then
    return 'identity_exists';
  end if;
  return 'available';
end $$;
revoke all on function public.signup_email_status(text) from public, anon, authenticated;
grant execute on function public.signup_email_status(text) to service_role;
comment on function public.signup_email_status(text) is 'Server-only registration preflight; admin_exists comes only from admin_users. claim_signup remains the atomic final authority.';

commit;
