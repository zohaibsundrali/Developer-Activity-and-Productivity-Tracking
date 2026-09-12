begin;
-- Provider success is not proof that the reserved identity is absent. Keep
-- recovery state until Auth and application links have actually disappeared.
create or replace function public.finish_invitation_cleanup(p_id uuid,p_claim uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog,public,app_private
as $$
declare invitation public.invitations%rowtype; attempt app_private.invitation_attempts%rowtype;
begin
  select * into invitation from public.invitations where id=p_id for update;
  select * into attempt from app_private.invitation_attempts where invitation_id=p_id for update;
  if attempt.invitation_id is null then return; end if;
  if attempt.claim_id is distinct from p_claim or attempt.completed_at is not null
    or attempt.lease_until<=now() or invitation.id is null
    or not (invitation.status in ('revoked','expired') or (invitation.status='pending' and invitation.expires_at<=now())) then
    raise exception 'INVITATION_CLEANUP_UNAVAILABLE';
  end if;
  if exists(select 1 from auth.users where id=attempt.auth_user_id)
    or exists(select 1 from public.admin_users where auth_user_id=attempt.auth_user_id)
    or exists(select 1 from public.developers where auth_user_id=attempt.auth_user_id)
    or exists(select 1 from public.clients where auth_user_id=attempt.auth_user_id) then
    raise exception 'INVITATION_CLEANUP_UNCONFIRMED';
  end if;
  delete from app_private.invitation_attempts where invitation_id=p_id and claim_id=p_claim;
end; $$;
revoke all on function public.finish_invitation_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_invitation_cleanup(uuid,uuid) to service_role;
commit;
