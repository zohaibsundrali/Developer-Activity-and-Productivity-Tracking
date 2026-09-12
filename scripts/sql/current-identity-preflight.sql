-- Read-only counts; no names, emails, credentials or user records are returned.
-- Resolve discrepancies through the existing identity/role recovery workflows;
-- do not bulk copy claims or assign guessed Auth links to make these counts zero.
with profiles as (
 select 'admin'::text kind,id,organization_id,auth_user_id from public.admin_users
 union all select 'developer',id,organization_id,auth_user_id from public.developers
 union all select 'client',id,organization_id,auth_user_id from public.clients
)
select m.user_type,
 count(*) as active_memberships,
 count(*) filter(where p.id is null) as missing_profiles,
 count(*) filter(where p.id is not null and p.auth_user_id is null) as missing_auth_links,
 count(*) filter(where p.auth_user_id is not null and u.id is null) as missing_auth_accounts,
 count(*) filter(where u.id is not null and (
  u.raw_app_meta_data->>'organization_id' is distinct from m.organization_id::text
  or u.raw_app_meta_data->>'app_user_id' is distinct from m.user_id::text
  or u.raw_app_meta_data->>'user_type' is distinct from m.user_type
  or u.raw_app_meta_data->>'role' is distinct from m.role)) as mismatched_auth_metadata,
 count(*) filter(where u.deleted_at is not null or u.banned_until>now()) as disabled_auth_accounts
from public.memberships m
left join profiles p on p.kind=m.user_type and p.id=m.user_id and p.organization_id=m.organization_id
left join auth.users u on u.id=p.auth_user_id
where m.status='active'
group by m.user_type order by m.user_type;
