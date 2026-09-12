-- Read-only investigation aid. This lists trusted metadata matches; it does
-- NOT prove that a missing link was accidental or authorize restoring access.
-- Verify original provisioning records before the operator preview/apply flow.
-- No emails, passwords, tokens or Auth metadata bodies are returned.
with profiles as (
 select 'admin'::text kind,id,organization_id,auth_user_id from public.admin_users
 union all select 'developer',id,organization_id,auth_user_id from public.developers
 union all select 'client',id,organization_id,auth_user_id from public.clients
)
select m.organization_id, m.user_id as profile_id, m.user_type, m.role,
 u.id as auth_user_id,
 p.id is null as profile_missing,
 p.id is not null and p.organization_id is null as profile_organization_missing,
 p.id is not null and p.auth_user_id is null as auth_link_missing,
 p.organization_id is not null and p.organization_id<>m.organization_id as organization_conflict,
 p.auth_user_id is not null and p.auth_user_id<>u.id as auth_link_conflict,
 count(*) over(partition by m.organization_id,m.user_id,m.user_type) as matching_auth_accounts
from public.memberships m
join auth.users u on u.raw_app_meta_data->>'organization_id'=m.organization_id::text
 and u.raw_app_meta_data->>'app_user_id'=m.user_id::text
 and u.raw_app_meta_data->>'user_type'=m.user_type
 and u.raw_app_meta_data->>'role'=m.role
left join profiles p on p.kind=m.user_type and p.id=m.user_id
where m.status='active' and not m.deletion_blocked
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and u.email_confirmed_at is not null
 and (p.id is null or p.organization_id is distinct from m.organization_id or p.auth_user_id is distinct from u.id)
order by m.organization_id,m.user_type,m.user_id,u.id;
