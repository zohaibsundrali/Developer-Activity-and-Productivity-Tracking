-- Read-only before/after deployment check. Do not guess ownership for rows with
-- zero/multiple historical identities. Explicit typed ownership is authoritative.
select p.id as project_id,p.organization_id,r.field,r.reference,r.profile_type,
 count(distinct m.user_type) as historical_profile_types,
 case when count(distinct m.user_type)=1 then min(m.user_type) end as sole_type_if_unique
from public.projects p
cross join lateral(values
 ('created_by',to_jsonb(p)->>'created_by',to_jsonb(p)->>'created_by_type'),
 ('added_by',to_jsonb(p)->>'added_by',to_jsonb(p)->>'added_by_type'),
 ('manager_id',to_jsonb(p)->>'manager_id',to_jsonb(p)->>'manager_type'),
 ('legacy_admin_id',to_jsonb(p)->>'admin_id',null::text)
) r(field,reference,profile_type)
left join public.memberships m on m.organization_id=p.organization_id and m.user_id::text=r.reference
 and m.user_type in ('admin','developer')
where r.reference is not null
group by p.id,p.organization_id,r.field,r.reference,r.profile_type
having (r.profile_type is null and count(distinct m.user_type)<>1)
 or (r.profile_type is not null and not coalesce(bool_or(m.user_type=r.profile_type),false));

-- Legacy email ownership is usable only if exactly one historical staff profile
-- matches. Return project identifiers/counts without printing email addresses.
select p.id as project_id,p.organization_id,count(m.user_id) as matching_profiles
from public.projects p left join public.memberships m on m.organization_id=p.organization_id
 and m.user_type in ('admin','developer') and lower(btrim(m.email))=lower(btrim(to_jsonb(p)->>'added_by_admin'))
where nullif(btrim(to_jsonb(p)->>'added_by_admin'),'') is not null
group by p.id,p.organization_id having count(m.user_id)<>1;
