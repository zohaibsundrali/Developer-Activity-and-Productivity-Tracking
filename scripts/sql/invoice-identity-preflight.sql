-- Read-only review before typed invoicing. Does not repair or delete records.
-- Returned groups cannot be assigned a profile type from current membership
-- and organization profile evidence without further review.
with candidates as (
 select il.organization_id, il.project_id, il.user_id, il.week_start,
        count(*) as invoice_lines,
        array(select distinct m.user_type from public.memberships m
              where m.organization_id=il.organization_id and m.user_id=il.user_id
                and m.user_type in ('admin','developer')
              order by m.user_type) as membership_types,
        exists(select 1 from public.admin_users p where p.organization_id=il.organization_id and p.id=il.user_id) as admin_profile_exists,
        exists(select 1 from public.developers p where p.organization_id=il.organization_id and p.id=il.user_id) as developer_profile_exists
 from public.invoice_lines il where il.source='timesheet' and (to_jsonb(il)->>'user_type') is null
 group by il.organization_id,il.project_id,il.user_id,il.week_start
)
select *, 'REVIEW_REQUIRED: preserve historical invoices and verify original typed ownership' as next_step
from candidates where cardinality(membership_types)<>1
 or (membership_types[1]='admin' and not admin_profile_exists)
 or (membership_types[1]='developer' and not developer_profile_exists)
order by organization_id,project_id,user_id,week_start;
