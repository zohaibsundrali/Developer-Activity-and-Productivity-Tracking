begin;
create or replace function public.auth_can_invite_role(p_role text) returns boolean
language sql stable security definer set search_path=pg_catalog,public
as $$ select coalesce(public.auth_org() is not null and not public.auth_is_client()
  and coalesce(public.auth_override('member.invite'),public.auth_role() in ('owner','admin','hr','manager'),false)
  and public.role_rank(p_role)<public.role_rank(public.auth_role()),false) $$;
revoke all on function public.auth_can_invite_role(text) from public;
grant execute on function public.auth_can_invite_role(text) to authenticated;
alter table public.invitations enable row level security;
-- Tokens confer the right to create a login. An inviter must not read tokens
-- for roles they cannot grant, even if another permissive org policy exists.
create policy invitation_role_authority on public.invitations as restrictive for all to authenticated
  using(organization_id=public.auth_org() and public.auth_can_invite_role(role))
  with check(organization_id=public.auth_org() and public.auth_can_invite_role(role));
-- Deleting an attempt would erase the identity reserved for Auth recovery.
create policy invitation_no_direct_delete on public.invitations as restrictive for delete to authenticated using(false);

create or replace function public.guard_invitation_mutation() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public
as $$ begin
  if current_user in ('postgres','service_role','supabase_admin') then return new; end if;
  if not public.auth_can_invite_role(new.role) then raise exception 'permission denied: invitation role' using errcode='42501'; end if;
  if tg_op='INSERT' then
    if new.status<>'pending' then raise exception 'New invitations must be pending' using errcode='23514'; end if;
    new.invited_by:=public.auth_app_user_id();
  else
    -- Browser management supports revocation. Acceptance remains exclusively
    -- the service transaction that verifies Auth, Terms and membership rows.
    if old.status<>'pending' or new.status<>'revoked'
      or (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
      raise exception 'Only pending invitation revocation is allowed directly' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
create trigger a_invitation_authority before insert or update on public.invitations
  for each row execute function public.guard_invitation_mutation();

create or replace function app_private.guard_pending_invitation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private
as $$ begin
  if new.status<>'pending' then return new; end if;
  new.email:=lower(btrim(new.email));
  if new.email is null or length(new.email)>254 or new.email !~ '^[^[:space:]@,;]+@[^[:space:]@.,;]+(\.[^[:space:]@.,;]+)+$' then
    raise exception 'A valid invitation email is required' using errcode='23514';
  end if;
  if new.expires_at is null or new.expires_at<=now() then raise exception 'Invitation expiry must be in the future' using errcode='23514'; end if;
  if new.role='owner' or public.role_rank(new.role) is null then raise exception 'Invalid invitation role' using errcode='23514'; end if;
  perform app_private.lock_quota(new.organization_id);
  if not app_private.org_unlocked(new.organization_id) then raise exception 'BILLING_LOCKED: subscription requires attention'; end if;
  if new.role='client' and not app_private.plan_feature(new.organization_id,'client_portal') then raise exception 'PLAN_FEATURE_REQUIRED: client_portal'; end if;
  if exists(select 1 from public.invitations i where i.organization_id=new.organization_id
      and lower(btrim(i.email))=new.email and i.status='pending' and i.expires_at>now() and i.id<>new.id) then
    raise exception 'INVITATION_EXISTS: an unexpired invitation already exists' using errcode='23505';
  end if;
  if new.team_id is not null and not exists(select 1 from public.teams where id=new.team_id and organization_id=new.organization_id) then raise exception 'Invalid invitation team' using errcode='23514'; end if;
  if new.department_id is not null and not exists(select 1 from public.departments where id=new.department_id and organization_id=new.organization_id) then raise exception 'Invalid invitation department' using errcode='23514'; end if;
  if new.project_id is not null and not exists(select 1 from public.projects where id=new.project_id and organization_id=new.organization_id) then raise exception 'Invalid invitation project' using errcode='23514'; end if;
  return new;
end; $$;
revoke all on function app_private.guard_pending_invitation() from public,anon,authenticated;
create trigger z_invitation_pending before insert or update on public.invitations
  for each row execute function app_private.guard_pending_invitation();
commit;
