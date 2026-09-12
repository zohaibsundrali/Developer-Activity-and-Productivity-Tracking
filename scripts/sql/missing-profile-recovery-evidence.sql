-- READ ONLY. Run as a trusted operator, not as a browser user.
-- Requires the invitation, reserved-profile-provisioning, transactional-signup,
-- and organization-deletion migrations. No emails, tokens, grant hashes,
-- password material, signup details, or full Auth metadata are returned.
-- A provenance match is evidence for review, NEVER permission to reconstruct.
with profiles as (
 select 'admin'::text kind,id,organization_id,auth_user_id from public.admin_users
 union all select 'developer',id,organization_id,auth_user_id from public.developers
 union all select 'client',id,organization_id,auth_user_id from public.clients
), missing as (
 select m.id membership_id,m.organization_id,m.user_id profile_id,m.user_type,m.role,m.email,
  m.deletion_blocked,p.id is not null typed_profile_exists,p.organization_id profile_organization_id,
  o.id is not null organization_exists,to_jsonb(o)->>'status' organization_status,
  coalesce(to_jsonb(o)?'status',false) organization_status_field_present,
  coalesce(to_jsonb(o)?'owner_id',false) owner_pointer_field_present,
  to_jsonb(o)->>'owner_id'=m.user_id::text owner_pointer_matches,
  exists(select 1 from app_private.organization_deletions d where d.organization_id=m.organization_id) organization_deleting
 from public.memberships m
 left join profiles p on p.kind=m.user_type and p.id=m.user_id
 left join public.organizations o on o.id=m.organization_id
 where m.status='active' and m.user_type in ('admin','client')
  and (p.id is null or p.organization_id is distinct from m.organization_id)
), evidence as (
 select m.*,
  (select count(*) from public.memberships other where other.user_id=m.profile_id and other.user_type=m.user_type
    and other.organization_id is distinct from m.organization_id) other_tenant_memberships,
  coalesce((select jsonb_agg(jsonb_build_object(
   'auth_user_id',u.id,'role_matches',u.raw_app_meta_data->>'role'=m.role,
   'membership_email_matches',nullif(lower(btrim(m.email)),'') is not null and lower(btrim(u.email))=lower(btrim(m.email)),
   'email_confirmed',u.email_confirmed_at is not null,'deleted',u.deleted_at is not null,
   'currently_banned',coalesce(u.banned_until>now(),false),
   'existing_profile_links',(select count(*) from profiles linked where linked.auth_user_id=u.id)
  ) order by u.id) from auth.users u where u.raw_app_meta_data->>'organization_id'=m.organization_id::text
   and u.raw_app_meta_data->>'app_user_id'=m.profile_id::text and u.raw_app_meta_data->>'user_type'=m.user_type),'[]'::jsonb) auth_evidence,
  coalesce((select jsonb_agg(jsonb_build_object(
   'record_id',s.id,'reserved_auth_user_id',s.auth_user_id,'created_at',s.created_at,'completed',s.completed_at is not null,
   'membership_email_matches',nullif(lower(btrim(m.email)),'') is not null and lower(btrim(s.email))=lower(btrim(m.email)),
   'original_profile_fields_present',nullif(btrim(s.details->>'fullName'),'') is not null and nullif(btrim(s.details->>'company'),'') is not null,
   'terms_evidence_present',nullif(btrim(s.terms_version),'') is not null,
   'role_matches',m.role='owner','reserved_auth_exists',u.id is not null,
   'reservation_metadata_matches',coalesce(u.raw_app_meta_data->>'signup_id'=s.id::text
    and u.raw_app_meta_data->>'organization_id'=s.organization_id::text
    and u.raw_app_meta_data->>'app_user_id'=s.profile_id::text
    and u.raw_app_meta_data->>'user_type'='admin' and u.raw_app_meta_data->>'role'='owner',false)
  ) order by s.created_at,s.id) from app_private.signup_attempts s left join auth.users u on u.id=s.auth_user_id
   where m.user_type='admin' and s.profile_id=m.profile_id and s.organization_id=m.organization_id),'[]'::jsonb) signup_evidence,
  coalesce((select jsonb_agg(jsonb_build_object(
   'record_id',r.id,'reserved_auth_user_id',r.auth_user_id,'created_at',r.created_at,'completed',r.completed_at is not null,
   'role_matches',r.role=m.role,
   'membership_email_matches',nullif(lower(btrim(m.email)),'') is not null and lower(btrim(r.email))=lower(btrim(m.email)),
   'reserved_auth_exists',u.id is not null,
   'reservation_metadata_matches',coalesce(u.raw_app_meta_data->>'provisioning_id'=r.id::text
    and u.raw_app_meta_data->>'organization_id'=r.organization_id::text
    and u.raw_app_meta_data->>'app_user_id'=r.profile_id::text
    and u.raw_app_meta_data->>'user_type'=r.user_type and u.raw_app_meta_data->>'role'=r.role,false)
  ) order by r.created_at,r.id) from app_private.profile_provisioning r left join auth.users u on u.id=r.auth_user_id
   where r.profile_id=m.profile_id and r.organization_id=m.organization_id and r.user_type=m.user_type),'[]'::jsonb) provisioning_evidence,
  coalesce((select jsonb_agg(jsonb_build_object(
   'invitation_id',i.id,'reserved_auth_user_id',a.auth_user_id,'status',i.status,'completed',a.completed_at is not null,
   'role_matches',i.role=m.role,
   'membership_email_matches',nullif(lower(btrim(m.email)),'') is not null and lower(btrim(i.email))=lower(btrim(m.email)),
   'reserved_auth_exists',u.id is not null,
   'reservation_metadata_matches',coalesce(u.raw_app_meta_data->>'invitation_id'=i.id::text
    and u.raw_app_meta_data->>'organization_id'=i.organization_id::text
    and u.raw_app_meta_data->>'app_user_id'=a.profile_id::text
    and u.raw_app_meta_data->>'user_type'=m.user_type and u.raw_app_meta_data->>'role'=i.role,false)
  ) order by i.id) from app_private.invitation_attempts a join public.invitations i on i.id=a.invitation_id
   left join auth.users u on u.id=a.auth_user_id
   where a.profile_id=m.profile_id and i.organization_id=m.organization_id
    and m.user_type=case when i.role='admin' then 'admin' when i.role='client' then 'client' else 'developer' end),'[]'::jsonb) invitation_evidence,
  (select count(*) from public.terms_acceptances t where t.organization_id=m.organization_id
    and t.user_id=m.profile_id and t.user_type=m.user_type and t.document='terms_of_service') typed_terms_records
 from missing m
), report as (
 select membership_id,organization_id,profile_id,user_type,role,typed_profile_exists,profile_organization_id,
  organization_exists,organization_status,organization_status_field_present,owner_pointer_field_present,coalesce(owner_pointer_matches,false) owner_pointer_matches,
  coalesce(deletion_blocked,false) deletion_blocked,organization_deleting,other_tenant_memberships,
  auth_evidence,signup_evidence,provisioning_evidence,invitation_evidence,typed_terms_records,
  false automatic_reconstruction_allowed,
  case
   when not organization_exists or organization_status is distinct from 'active' or deletion_blocked or organization_deleting then 'resolve_organization_lifecycle_first'
   when typed_profile_exists then 'review_existing_profile_organization_conflict'
   when other_tenant_memberships>0 then 'review_cross_organization_identity_conflict'
   when jsonb_array_length(auth_evidence)=0 then 'verify_original_identity_and_missing_auth_separately'
   when jsonb_array_length(auth_evidence)>1 then 'resolve_ambiguous_auth_candidates'
   when not coalesce((auth_evidence->0->>'role_matches')::boolean,false)
    or not coalesce((auth_evidence->0->>'membership_email_matches')::boolean,false)
    or not coalesce((auth_evidence->0->>'email_confirmed')::boolean,false)
    or coalesce((auth_evidence->0->>'deleted')::boolean,false)
    or coalesce((auth_evidence->0->>'currently_banned')::boolean,false) then 'resolve_auth_identity_authority_first'
   when (auth_evidence->0->>'existing_profile_links')::integer>0 then 'review_existing_auth_profile_links'
   when role='owner' and owner_pointer_matches is distinct from true then 'review_original_organization_owner'

   when jsonb_array_length(signup_evidence)+jsonb_array_length(provisioning_evidence)+jsonb_array_length(invitation_evidence)>0 then 'review_original_records_for_explicit_profile_restore'
   else 'obtain_original_onboarding_record_or_verified_backup'
  end next_review_step
 from evidence
)
select jsonb_build_object(
 'read_only',true,
 'missing_or_misplaced_profiles',coalesce((select jsonb_agg(to_jsonb(report_row) order by user_type,organization_id,profile_id) from report report_row),'[]'::jsonb),
 'notice','Evidence only. No profile, Auth account, role, or identity link has been created or changed.'
) as missing_profile_recovery_evidence;
