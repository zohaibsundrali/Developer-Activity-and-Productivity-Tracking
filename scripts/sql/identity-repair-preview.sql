-- Preview only: no links, roles, profiles or Auth accounts are changed.
-- Requires migrations 20260912043321 and 20260912043604.
-- These exact eleven candidates were supplied by the operator.
with candidates(org_id,profile_id,auth_id) as (
 values
 ('3b63ee84-c307-4b1b-a080-913be7f8d7b7'::uuid,'021d9c2e-fc96-4106-8570-6ef31541ac5f'::uuid,'e8ce3920-2f98-4c3b-ac87-9af209656275'::uuid),
 ('7b6c3bdd-a384-4f93-971d-678e61989db2','907d648b-651e-420a-90b8-7adeb2756687','775ae95a-4c58-44f9-8321-f7179d877cfd'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','187df90e-f8be-4338-9889-b97906e746d6','21772247-c377-4bdb-bffa-86ec16146089'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','5c6532e6-74fb-453d-9fbd-390b46c2e4e6','022ac1e1-0095-4092-9335-b3fe892fea93'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','6b8f841c-ed87-49a8-9636-2e53c1d22843','37a18b84-2af8-4d5e-a64f-66e2ab78380d'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','6f4a3322-cf50-4be6-94a8-b4aac758ae59','3bdd7bc3-b3b9-4fa4-9b60-61f60440d0dc'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','6f5488cd-cb29-441e-99d9-c6285acefbae','0988bb01-f0e6-45da-982a-0a76c4d7bfac'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','9a24dcbd-e6a9-4d4b-92a8-9a794a92252a','d78b5a58-f1f0-4c0f-9528-86d6e6334227'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','e34c73c8-24a2-4967-a584-16bae96f229a','8d380e53-7270-4274-ab3c-66ab9ef64025'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','ea4ecce3-0e74-4201-9c4c-776dca1b0be3','f0332724-b44a-4a73-b203-c23dee5af94b'),
 ('d320f0c6-b62d-4b1f-8b64-7564cbc080c9','ec8d37c5-35d9-4627-8549-b157fa507872','8b98e6ef-d0c8-4ed0-9797-7a33c8bdbcc0')
), previews as materialized (
 select public.operator_repair_profile_identity(
  p_org=>org_id,p_profile=>profile_id,p_type=>'developer',p_auth=>auth_id,
  p_apply=>false,p_allow_null_org=>false
 ) as result from candidates
), profiles as (
 select 'admin'::text kind,id,organization_id from public.admin_users
 union all select 'developer',id,organization_id from public.developers
 union all select 'client',id,organization_id from public.clients
), unresolved as (
 select m.id as membership_id,m.organization_id,m.user_id as profile_id,m.user_type,m.role,
  m.deletion_blocked,p.id is not null as typed_profile_exists,
  p.organization_id as profile_organization_id,
  to_jsonb(o)->>'owner_id' as organization_owner_profile_id,
  coalesce((select jsonb_agg(jsonb_build_object(
    'auth_user_id',u.id,'auth_role',u.raw_app_meta_data->>'role',
    'email_confirmed',u.email_confirmed_at is not null,
    'deleted',u.deleted_at is not null,
    'currently_banned',coalesce(u.banned_until>now(),false)))
   from auth.users u
   where u.raw_app_meta_data->>'organization_id'=m.organization_id::text
    and u.raw_app_meta_data->>'app_user_id'=m.user_id::text
    and u.raw_app_meta_data->>'user_type'=m.user_type),'[]'::jsonb) as auth_metadata_candidates
 from public.memberships m
 left join profiles p on p.id=m.user_id and p.kind=m.user_type
 left join public.organizations o on o.id=m.organization_id
 where m.status='active' and m.user_type in ('admin','client')
  and (p.id is null or p.organization_id is distinct from m.organization_id)
)
select jsonb_build_object(
 'staff_link_previews',coalesce((select jsonb_agg(result) from previews),'[]'::jsonb),
 'admin_client_profile_checks',coalesce((select jsonb_agg(to_jsonb(u)) from unresolved u),'[]'::jsonb)
) as identity_review;
