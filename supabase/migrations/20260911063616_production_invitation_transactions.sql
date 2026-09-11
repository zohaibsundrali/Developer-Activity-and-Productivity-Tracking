-- Apply after device sessions. Auth remains managed through the Auth API;
-- every application row and invitation consumption commit in one transaction.
begin;
create table app_private.invitation_attempts (
  invitation_id uuid primary key references public.invitations(id) on delete cascade,
  claim_id uuid not null,
  profile_id uuid not null default gen_random_uuid(),
  auth_user_id uuid not null default gen_random_uuid(),
  lease_until timestamptz not null,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on app_private.invitation_attempts from public,anon,authenticated;

create or replace function public.claim_invitation(p_id uuid,p_claim uuid) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,app_private
as $$ declare invitation public.invitations%rowtype; attempt app_private.invitation_attempts%rowtype;
begin
  select * into invitation from public.invitations where id=p_id for update;
  if not found or invitation.status<>'pending' or invitation.expires_at<=now() then
    raise exception 'INVITATION_UNAVAILABLE' using errcode='P0001';
  end if;
  insert into app_private.invitation_attempts(invitation_id,claim_id,lease_until)
    values(p_id,p_claim,now()+interval '5 minutes')
    on conflict(invitation_id) do update set claim_id=excluded.claim_id,lease_until=excluded.lease_until,updated_at=now()
      where invitation_attempts.completed_at is null and invitation_attempts.lease_until<=now()
    returning * into attempt;
  if attempt.invitation_id is null then raise exception 'INVITATION_BUSY: acceptance already in progress' using errcode='P0001'; end if;
  return jsonb_build_object('profile_id',attempt.profile_id,'auth_user_id',attempt.auth_user_id);
end; $$;

create or replace function public.finish_invitation(p_id uuid,p_claim uuid,p_name text,p_terms_version text,p_ip inet default null) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,app_private
as $$ declare invitation public.invitations%rowtype; attempt app_private.invitation_attempts%rowtype; kind text; company_name text;
begin
  select * into invitation from public.invitations where id=p_id for update;
  select * into attempt from app_private.invitation_attempts where invitation_id=p_id for update;
  if invitation.id is null or invitation.status<>'pending' or invitation.expires_at<=now()
    or attempt.claim_id is distinct from p_claim or attempt.lease_until<=now() or attempt.completed_at is not null then
    raise exception 'INVITATION_UNAVAILABLE' using errcode='P0001';
  end if;
  if invitation.role='owner' or public.role_rank(invitation.role) is null then raise exception 'Invalid invitation role'; end if;
  kind:=case when invitation.role='admin' then 'admin' when invitation.role='client' then 'client' else 'developer' end;
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
end; $$;

-- Release the lease without deleting a potentially committed Auth account.
-- A retry reuses both reserved IDs and repairs the same attempt.
create or replace function public.release_invitation_claim(p_id uuid,p_claim uuid) returns void
language sql volatile security definer set search_path=pg_catalog,public,app_private
as $$ update app_private.invitation_attempts set lease_until=now(),updated_at=now()
  where invitation_id=p_id and claim_id=p_claim and completed_at is null; $$;

revoke all on function public.claim_invitation(uuid,uuid),public.finish_invitation(uuid,uuid,text,text,inet),public.release_invitation_claim(uuid,uuid) from public;
grant execute on function public.claim_invitation(uuid,uuid),public.finish_invitation(uuid,uuid,text,text,inet),public.release_invitation_claim(uuid,uuid) to service_role;

create or replace function public.claim_invitation_cleanup(p_limit integer default 50) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public,app_private
as $$ declare row record; claim uuid; result jsonb:='[]'::jsonb; begin
  for row in select a.invitation_id,a.auth_user_id,a.profile_id,i.organization_id from app_private.invitation_attempts a
    join public.invitations i on i.id=a.invitation_id
    where a.completed_at is null and a.lease_until<=now() and (i.status in ('revoked','expired') or (i.status='pending' and i.expires_at<=now()))
    -- A manually recovered/linked account is no longer an orphan.
    and not exists(select 1 from public.admin_users p where p.auth_user_id=a.auth_user_id)
    and not exists(select 1 from public.developers p where p.auth_user_id=a.auth_user_id)
    and not exists(select 1 from public.clients p where p.auth_user_id=a.auth_user_id)
    order by a.updated_at limit least(greatest(p_limit,1),100) for update of a,i skip locked
  loop
    claim:=gen_random_uuid();
    update app_private.invitation_attempts set claim_id=claim,lease_until=now()+interval '5 minutes',updated_at=now() where invitation_id=row.invitation_id;
    result:=result||jsonb_build_array(jsonb_build_object('invitation_id',row.invitation_id,'auth_user_id',row.auth_user_id,'profile_id',row.profile_id,'organization_id',row.organization_id,'claim_id',claim));
  end loop;
  return result;
end; $$;
create or replace function public.finish_invitation_cleanup(p_id uuid,p_claim uuid) returns void
language sql volatile security definer set search_path=pg_catalog,public,app_private
as $$ delete from app_private.invitation_attempts where invitation_id=p_id and claim_id=p_claim and completed_at is null; $$;
revoke all on function public.claim_invitation_cleanup(integer),public.finish_invitation_cleanup(uuid,uuid) from public;
grant execute on function public.claim_invitation_cleanup(integer),public.finish_invitation_cleanup(uuid,uuid) to service_role;
commit;
