-- Read only; run before the typed timesheet migrations.
-- Zero rows means each legacy time-log identity has one supported typed profile.
-- Rows require original identity evidence; do not guess or delete their hours.
with identities as (
  select organization_id, developer_id, count(*) as time_logs,
         count(*) filter (where ended_at is null) as open_timers,
         min(started_at) as first_log, max(started_at) as last_log
  from public.task_time_logs
  group by organization_id, developer_id
), reviewed as (
  select i.*, array(
    select distinct m.user_type from public.memberships m
    where m.organization_id=i.organization_id and m.user_id=i.developer_id
      and m.user_type in ('admin','developer') order by m.user_type
  ) as membership_types,
  exists(select 1 from public.admin_users p where p.organization_id=i.organization_id and p.id=i.developer_id) as admin_profile_exists,
  exists(select 1 from public.developers p where p.organization_id=i.organization_id and p.id=i.developer_id) as developer_profile_exists
  from identities i
)
select *, 'REVIEW_REQUIRED: retain the records and verify original typed ownership' as next_step
from reviewed
where cardinality(membership_types)<>1
   or (membership_types[1]='admin' and not admin_profile_exists)
   or (membership_types[1]='developer' and not developer_profile_exists)
order by organization_id, developer_id;
