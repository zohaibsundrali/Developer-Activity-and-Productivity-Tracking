-- Organization co-owners; platform administration remains independently authorized.
begin;
lock table public.memberships, public.invitations in share row exclusive mode;

CREATE OR REPLACE FUNCTION public.role_rank(p_role text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case p_role
    when 'owner'     then 100
    when 'manager'   then 70
    when 'hr'        then 60
    when 'finance'   then 55
    when 'team_lead' then 50
    when 'qa'        then 35
    when 'developer' then 30
    when 'designer'  then 30
    when 'devops'    then 30
    when 'employee'  then 20
    when 'client'    then 10
    else null
  end
$function$
;

create or replace function public.auth_can_invite_role(p_role text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(public.auth_org() is not null and not public.auth_is_client()
 and coalesce(public.auth_override('member.invite'),public.auth_role() in ('owner','hr','manager'),false)
 and public.role_rank(p_role) is not null
 and (public.auth_role()='owner' or public.role_rank(p_role)<public.role_rank(public.auth_role())),false)
$$;
revoke all on function public.auth_can_invite_role(text) from public,anon;
grant execute on function public.auth_can_invite_role(text) to authenticated;

CREATE OR REPLACE FUNCTION app_private.guard_pending_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$ begin
  if new.status<>'pending' then return new; end if;
  new.email:=lower(btrim(new.email));
  if new.email is null or length(new.email)>254 or new.email !~ '^[^[:space:]@,;]+@[^[:space:]@.,;]+(\.[^[:space:]@.,;]+)+$' then
    raise exception 'A valid invitation email is required' using errcode='23514';
  end if;
  if new.expires_at is null or new.expires_at<=now() then raise exception 'Invitation expiry must be in the future' using errcode='23514'; end if;
  if public.role_rank(new.role) is null then raise exception 'Invalid invitation role' using errcode='23514'; end if;
  perform app_private.lock_quota(new.organization_id);
  if new.role='owner' and not exists(select 1 from public.memberships m
    where m.organization_id=new.organization_id and m.user_id=new.invited_by
      and m.role='owner' and m.status='active' and not m.deletion_blocked) then
    raise exception 'OWNER_INVITER_REQUIRED' using errcode='42501';
  end if;
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
end; $function$
;
CREATE OR REPLACE FUNCTION public.finish_invitation(p_id uuid, p_claim uuid, p_name text, p_terms_version text, p_ip inet DEFAULT NULL::inet)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$ declare invitation public.invitations%rowtype; attempt app_private.invitation_attempts%rowtype; kind text; company_name text;
begin
  select * into invitation from public.invitations where id=p_id for update;
  select * into attempt from app_private.invitation_attempts where invitation_id=p_id for update;
  if invitation.id is null or invitation.status<>'pending' or invitation.expires_at<=now()
    or attempt.claim_id is distinct from p_claim or attempt.lease_until<=now() or attempt.completed_at is not null then
    raise exception 'INVITATION_UNAVAILABLE' using errcode='P0001';
  end if;
  if public.role_rank(invitation.role) is null then raise exception 'Invalid invitation role'; end if;
  perform app_private.lock_quota(invitation.organization_id);
  if invitation.role='owner' and not exists(select 1 from public.memberships m
    where m.organization_id=invitation.organization_id and m.user_id=invitation.invited_by
      and m.role='owner' and m.status='active' and not m.deletion_blocked) then
    raise exception 'OWNER_INVITER_REQUIRED' using errcode='42501';
  end if;
  kind:=case when invitation.role='owner' then 'admin' when invitation.role='client' then 'client' else 'developer' end;
  -- Revalidate scope in the SAME transaction, after any asynchronous Auth call.
  if invitation.team_id is not null and not exists(select 1 from public.teams where id=invitation.team_id and organization_id=invitation.organization_id) then raise exception 'Invalid invitation team'; end if;
  if invitation.department_id is not null and not exists(select 1 from public.departments where id=invitation.department_id and organization_id=invitation.organization_id) then raise exception 'Invalid invitation department'; end if;
  if invitation.project_id is not null and not exists(select 1 from public.projects where id=invitation.project_id and organization_id=invitation.organization_id) then raise exception 'Invalid invitation project'; end if;
  if kind='client' and not app_private.plan_feature(invitation.organization_id,'client_portal') then raise exception 'PLAN_FEATURE_REQUIRED: client_portal'; end if;
  if not exists(select 1 from auth.users u where u.id=attempt.auth_user_id and lower(u.email)=lower(invitation.email)
    and u.raw_app_meta_data->>'invitation_id'=invitation.id::text
    and u.raw_app_meta_data->>'organization_id'=invitation.organization_id::text
    and u.raw_app_meta_data->>'app_user_id'=attempt.profile_id::text
    and u.raw_app_meta_data->>'user_type'=kind and u.raw_app_meta_data->>'role'=invitation.role) then
    raise exception 'Invitation Auth account is not verified';
  end if;
  if p_terms_version is null or length(p_terms_version)=0 then raise exception 'Terms version is required'; end if;
  if kind='admin' then
    select name into company_name from public.organizations where id=invitation.organization_id;
    if company_name is null then raise exception 'Organization name is required'; end if;
    insert into public.admin_users(id,full_name,email,company,role,is_verified,organization_id,auth_user_id)
      values(attempt.profile_id,p_name,invitation.email,company_name,'admin',true,invitation.organization_id,attempt.auth_user_id);
  elsif kind='client' then
    insert into public.clients(id,name,email,status,organization_id,auth_user_id)
      values(attempt.profile_id,p_name,invitation.email,'active',invitation.organization_id,attempt.auth_user_id);
  else
    insert into public.developers(id,name,email,status,organization_id,auth_user_id)
      values(attempt.profile_id,p_name,invitation.email,'active',invitation.organization_id,attempt.auth_user_id);
  end if;
  insert into public.memberships(organization_id,user_id,user_type,email,role,team_id,department_id,status)
    values(invitation.organization_id,attempt.profile_id,kind,invitation.email,invitation.role,invitation.team_id,invitation.department_id,'active');
  if kind='client' and invitation.project_id is not null then
    insert into public.project_clients(organization_id,project_id,client_id) values(invitation.organization_id,invitation.project_id,attempt.profile_id);
  end if;
  insert into public.terms_acceptances(organization_id,user_id,user_type,email,document,document_version,entry_point,accepted_at,ip)
    values(invitation.organization_id,attempt.profile_id,kind,invitation.email,'terms_of_service',p_terms_version,'invitation',now(),p_ip);
  update public.invitations set status='accepted' where id=p_id;
  update app_private.invitation_attempts set completed_at=now(),updated_at=now() where invitation_id=p_id;
  return jsonb_build_object('success',true,'role',invitation.role,'userType',kind);
end; $function$
;

revoke all on function public.finish_invitation(uuid,uuid,text,text,inet) from public,anon,authenticated;
grant execute on function public.finish_invitation(uuid,uuid,text,text,inet) to service_role;
revoke all on function app_private.guard_pending_invitation() from public,anon,authenticated;

-- Profile discriminator `admin` and the admin_users table are intentionally kept.
update public.memberships set role='owner' where role='admin';
-- Old pending invitations whose sender no longer owns the org must not confer
-- newly elevated owner access. Keep their records, but revoke their tokens.
update public.invitations i set status='revoked' where i.role='admin' and i.status='pending'
 and (i.expires_at<=now() or not exists(select 1 from public.memberships m
   where m.organization_id=i.organization_id and m.user_id=i.invited_by
     and m.role='owner' and m.status='active' and not m.deletion_blocked));
update public.invitations set role='owner' where role='admin';
update auth.users u set raw_app_meta_data=jsonb_set(u.raw_app_meta_data,'{role}','"owner"'::jsonb)
 where u.raw_app_meta_data->>'role'='admin' and (
 exists(select 1 from public.memberships m join public.admin_users p
   on p.id=m.user_id and p.organization_id=m.organization_id and p.auth_user_id=u.id
   where m.role='owner' and m.user_type='admin'
     and m.organization_id::text=u.raw_app_meta_data->>'organization_id'
     and m.user_id::text=u.raw_app_meta_data->>'app_user_id'
     and u.raw_app_meta_data->>'user_type'='admin')
 or exists(select 1 from public.invitations i join app_private.invitation_attempts a on a.invitation_id=i.id
   where a.auth_user_id=u.id and i.role='owner' and i.status='pending'
     and i.id::text=u.raw_app_meta_data->>'invitation_id'
     and i.organization_id::text=u.raw_app_meta_data->>'organization_id'
     and a.profile_id::text=u.raw_app_meta_data->>'app_user_id'
     and u.raw_app_meta_data->>'user_type'='admin'));

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in (
 'owner','manager','hr','finance','team_lead','qa','developer','designer','devops','employee','client'));
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check check (role in (
 'owner','manager','hr','finance','team_lead','qa','developer','designer','devops','employee','client'));
delete from public.role_permissions where role='admin';

-- Protect the final active owner, including direct REST/service writes. The
-- existing quota lock serializes concurrent changes for this organization.
create or replace function app_private.guard_last_organization_owner() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
begin
 if old.role='owner' and old.status='active' and not old.deletion_blocked then
   if tg_op='UPDATE' and new.organization_id=old.organization_id and new.role='owner'
      and new.status='active' and not new.deletion_blocked then return new; end if;
   perform app_private.lock_quota(old.organization_id);
   if not app_private.deletion_worker_context(old.organization_id) and not exists(
     select 1 from public.memberships m where m.organization_id=old.organization_id
       and m.id<>old.id and m.role='owner' and m.status='active' and not m.deletion_blocked
   ) then raise exception 'LAST_ORGANIZATION_OWNER: add another owner first' using errcode='23514'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function app_private.guard_last_organization_owner() from public,anon,authenticated;
create trigger aab_last_organization_owner before update or delete on public.memberships
 for each row execute function app_private.guard_last_organization_owner();
commit;
