begin;
create table app_private.identity_repair_audit (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 profile_id uuid not null, user_type text not null, auth_user_id uuid not null,
 operator_reference text not null, repaired_link boolean not null,
 repaired_organization boolean not null, created_at timestamptz not null default now()
);
alter table app_private.identity_repair_audit enable row level security;
revoke all on app_private.identity_repair_audit from public,anon,authenticated;

-- Explicit operator tool. Preview is the default and writes no rows. Neither
-- login nor self-service claim repair calls this service-only function.
create function public.operator_repair_profile_identity(
 p_org uuid,p_profile uuid,p_type text,p_auth uuid,
 p_apply boolean default false,p_allow_null_org boolean default false,
 p_ack text default null,p_operator_reference text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app_private as $$
declare rel text; profile jsonb; identity jsonb; membership jsonb; failures text[]:='{}';
 matches bigint; linked uuid; profile_org uuid; verified_email text; changed int; audit_id uuid;
 repair_link boolean; repair_org boolean;
begin
 if p_apply is null or p_allow_null_org is null or p_org is null or p_profile is null or p_auth is null or p_type not in ('admin','developer','client') or p_type is null then
  raise exception 'REPAIR_ARGUMENTS_REQUIRED' using errcode='22023';
 end if;
 if p_apply and (p_ack is distinct from 'REPAIR VERIFIED EXISTING IDENTITY' or
    length(btrim(coalesce(p_operator_reference,'')))<8 or length(p_operator_reference)>240) then
  raise exception 'OPERATOR_ACK_REQUIRED: supply acknowledgment and verification reference' using errcode='22023';
 end if;
 perform 1 from public.organizations where id=p_org for update;
 if not found then failures:=array_append(failures,'organization_missing'); end if;
 if app_private.organization_deleting(p_org) then failures:=array_append(failures,'organization_deleting'); end if;
 -- Auth row lock serializes repairs for the same Auth UUID and metadata edits.
 select to_jsonb(u) into identity from auth.users u where id=p_auth for update;
 if identity is null then failures:=array_append(failures,'auth_user_missing'); end if;
 rel:=case p_type when 'admin' then 'admin_users' when 'developer' then 'developers' else 'clients' end;
 execute format('select to_jsonb(p) from public.%I p where id=$1 for update',rel) into profile using p_profile;
 if profile is null then failures:=array_append(failures,'profile_missing'); end if;
 linked:=nullif(profile->>'auth_user_id','')::uuid;
 profile_org:=nullif(profile->>'organization_id','')::uuid;
 repair_link:=linked is null;
 repair_org:=profile_org is null;
 if linked is not null and linked<>p_auth then failures:=array_append(failures,'profile_link_conflict'); end if;
 if profile_org is not null and profile_org<>p_org then failures:=array_append(failures,'profile_organization_conflict'); end if;
 if repair_org and not p_allow_null_org then failures:=array_append(failures,'null_organization_opt_in_required'); end if;
 if not repair_link and not repair_org then failures:=array_append(failures,'identity_already_linked'); end if;
 if profile ? 'status' and profile->>'status' is distinct from 'active' then failures:=array_append(failures,'profile_inactive'); end if;

 perform 1 from public.memberships m where m.user_id=p_profile and m.user_type=p_type for update;
 select count(*) into matches from public.memberships m where m.user_id=p_profile and m.user_type=p_type;
 if matches<>1 then failures:=array_append(failures,'typed_membership_ambiguous_or_missing'); end if;
 select to_jsonb(m) into membership from public.memberships m where m.organization_id=p_org and m.user_id=p_profile and m.user_type=p_type;
 if membership is null or membership->>'status' is distinct from 'active' or membership->>'deletion_blocked'='true' then
  failures:=array_append(failures,'active_membership_required');
 end if;
 if identity->>'deleted_at' is not null or (identity->>'banned_until')::timestamptz>now() then failures:=array_append(failures,'auth_user_unavailable'); end if;
 if identity->>'email_confirmed_at' is null then failures:=array_append(failures,'confirmed_auth_email_required'); end if;
 verified_email:=nullif(lower(btrim(identity->>'email')),'');
 if verified_email is null or lower(btrim(profile->>'email')) is distinct from verified_email or lower(btrim(membership->>'email')) is distinct from verified_email then
  failures:=array_append(failures,'verified_emails_disagree');
 end if;
 if identity->'raw_app_meta_data'->>'organization_id' is distinct from p_org::text
  or identity->'raw_app_meta_data'->>'app_user_id' is distinct from p_profile::text
  or identity->'raw_app_meta_data'->>'user_type' is distinct from p_type
  or identity->'raw_app_meta_data'->>'role' is distinct from membership->>'role'
  or public.role_rank(membership->>'role') is null
  or (p_type='client') is distinct from (membership->>'role'='client')
  or (p_type='admin') is distinct from (membership->>'role' in ('owner','admin')) then
  failures:=array_append(failures,'trusted_metadata_disagrees');
 end if;
 select count(*) into matches from auth.users u where lower(btrim(u.email))=verified_email;
 if matches<>1 then failures:=array_append(failures,'auth_email_ambiguous'); end if;
 if exists(select 1 from public.memberships m where lower(btrim(m.email))=verified_email and
  (m.organization_id<>p_org or m.user_id<>p_profile or m.user_type<>p_type)) then failures:=array_append(failures,'membership_email_ambiguous'); end if;
 if exists(select 1 from (
  select id,organization_id,auth_user_id,email,'admin'::text kind from public.admin_users
  union all select id,organization_id,auth_user_id,email,'developer' from public.developers
  union all select id,organization_id,auth_user_id,email,'client' from public.clients
 ) p where (p.auth_user_id=p_auth or lower(btrim(p.email))=verified_email) and (p.id<>p_profile or p.kind<>p_type)) then
  failures:=array_append(failures,'profile_identity_ambiguous');
 end if;
 if exists(select 1 from app_private.invitation_attempts a where a.auth_user_id=p_auth or a.profile_id=p_profile)
  or exists(select 1 from app_private.profile_provisioning r where r.auth_user_id=p_auth or (r.profile_id=p_profile and r.user_type=p_type))
  or exists(select 1 from public.invitations i where lower(btrim(i.email))=verified_email and i.status='pending') then
  failures:=array_append(failures,'reserved_identity_requires_recovery');
 end if;
 if exists(select 1 from app_private.organization_deletion_items i join app_private.organization_deletions j on j.id=i.job_id
  where i.kind='auth' and i.resource_id=p_auth::text and i.status<>'retained' and j.status<>'completed') then
  failures:=array_append(failures,'auth_identity_scheduled_for_deletion');
 end if;
 if not p_apply then
  return jsonb_build_object('eligible',cardinality(failures)=0,'failures',to_jsonb(failures),
   'organizationId',p_org,'profileId',p_profile,'userType',p_type,'authUserId',p_auth,
   'wouldRepairLink',repair_link,'wouldRepairOrganization',repair_org,'applied',false);
 end if;
 if cardinality(failures)>0 then raise exception 'IDENTITY_REPAIR_REFUSED: %',array_to_string(failures,',') using errcode='42501'; end if;
 execute format('update public.%I set auth_user_id=coalesce(auth_user_id,$1), organization_id=coalesce(organization_id,$2)
  where id=$3 and (auth_user_id is null or auth_user_id=$1) and (organization_id is null or organization_id=$2)',rel)
  using p_auth,p_org,p_profile;
 get diagnostics changed = row_count;
 if changed<>1 then raise exception 'IDENTITY_CHANGED: inspect again' using errcode='40001'; end if;
 insert into app_private.identity_repair_audit(organization_id,profile_id,user_type,auth_user_id,operator_reference,repaired_link,repaired_organization)
 values(p_org,p_profile,p_type,p_auth,btrim(p_operator_reference),repair_link,repair_org) returning id into audit_id;
 return jsonb_build_object('applied',true,'auditId',audit_id,'organizationId',p_org,'profileId',p_profile,'userType',p_type,
  'repairedLink',repair_link,'repairedOrganization',repair_org);
end $$;
revoke all on function public.operator_repair_profile_identity(uuid,uuid,text,uuid,boolean,boolean,text,text) from public,anon,authenticated;
grant execute on function public.operator_repair_profile_identity(uuid,uuid,text,uuid,boolean,boolean,text,text) to service_role;
commit;
