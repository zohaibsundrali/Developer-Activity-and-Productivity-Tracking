-- READ ONLY. Run before deploying typed notification delivery.
-- A count other than one needs authoritative identity verification; never
-- resolve it by arbitrarily choosing one of the colliding profile types.
select n.id as notification_id,n.organization_id,n.admin_id,
  count(distinct (m.user_type,m.user_id)) filter(where m.user_id is not null) as matching_identities
from public.notifications n
left join public.memberships m on m.organization_id=n.organization_id
  and m.user_type in('admin','developer')
  and (nullif(btrim(n.admin_id::text),'') is null or m.user_id::text=btrim(n.admin_id::text))
  and (nullif(btrim(n.admin_email),'') is null or lower(btrim(m.email))=lower(btrim(n.admin_email)))
where nullif(btrim(n.admin_id::text),'') is not null or nullif(btrim(n.admin_email),'') is not null
group by n.id,n.organization_id,n.admin_id
having count(distinct (m.user_type,m.user_id)) filter(where m.user_id is not null) <> 1;

-- Submission delivery addresses the existing project creator. New delivery
-- requires exactly one active staff identity for that legacy creator ID.
select p.id as project_id,p.organization_id,coalesce(p.created_by,p.added_by) as creator_id,
  count(distinct (m.user_type,m.user_id)) filter(where m.user_id is not null) as active_matching_identities
from public.projects p
left join public.memberships m on m.organization_id=p.organization_id
  and m.user_id=coalesce(p.created_by,p.added_by) and m.user_type in('admin','developer') and m.status='active'
group by p.id,p.organization_id,p.created_by,p.added_by
having count(distinct (m.user_type,m.user_id)) filter(where m.user_id is not null) <> 1;
