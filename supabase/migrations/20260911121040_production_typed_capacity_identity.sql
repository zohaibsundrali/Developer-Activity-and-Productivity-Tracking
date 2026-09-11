-- Capacity combines developer-only work with typed staff records. A UUID
-- shared by admin and developer profiles must never merge their capacity.
-- Append user_type to preserve existing view columns/dependencies/grants.
begin;
create or replace view public.capacity_week_v
  with (security_invoker = true) as
with weeks as (
  -- Every (person, week) with a logged hour...
  select l.organization_id,
         l.developer_id                         as user_id,
         'developer'::text as user_type,
         public.timesheet_week_of(l.started_at) as week_start
    from public.task_time_logs l
   where l.seconds is not null
   group by l.organization_id, l.developer_id, public.timesheet_week_of(l.started_at)
  union
  -- ...or an approved day of leave in it. A week somebody spent entirely on
  -- leave has no time logs and is exactly the week a planner needs to see.
  select r.organization_id,
         r.user_id,
         r.user_type,
         public.timesheet_week_of(r.start_date::timestamptz)
    from public.leave_requests r
   where r.status = 'approved'
),
logged as (
  select l.organization_id,
         l.developer_id as user_id,
         'developer'::text as user_type,
         public.timesheet_week_of(l.started_at) as week_start,
         sum(l.seconds)::numeric / 3600 as logged_hours
    from public.task_time_logs l
   where l.seconds is not null
   group by l.organization_id, l.developer_id, public.timesheet_week_of(l.started_at)
),
leave_days as (
  -- Days of approved leave that fall INSIDE the week, not the whole request.
  -- A two-week holiday must not subtract ten days from each of the two weeks.
  select w.organization_id,
         w.user_id,
         w.user_type,
         w.week_start,
         coalesce(sum(
           greatest(
             0,
             least(r.end_date, w.week_start + 6) - greatest(r.start_date, w.week_start) + 1
           )
         ), 0)::numeric as days
    from weeks w
    left join public.leave_requests r
      on  r.organization_id = w.organization_id
      and r.user_id         = w.user_id
      and r.user_type       = w.user_type
      and r.status          = 'approved'
      and r.start_date     <= w.week_start + 6
      and r.end_date       >= w.week_start
   group by w.organization_id, w.user_id, w.user_type, w.week_start
),
allocated as (
  -- Share of a person committed to projects that are still running. Summed
  -- across projects, so 130% is expressible — see the header.
  select pm.organization_id,
         pm.user_id,
         pm.user_type,
         sum(pm.allocation_pct)::numeric        as allocation_pct,
         count(*) filter (where pm.allocation_pct is not null) as allocated_projects,
         count(*)                               as project_count
    from public.project_members pm
    join public.projects p on p.id = pm.project_id and p.organization_id = pm.organization_id
   where coalesce(p.status, '') not in ('completed','cancelled','closed')
   group by pm.organization_id, pm.user_id, pm.user_type
),
committed as (
  -- Estimated hours still outstanding on open tasks. Not week-scoped: it is a
  -- backlog, and what it answers is "is there more work than time", which has
  -- no week of its own.
  select t.organization_id,
         t.developer_id as user_id,
         'developer'::text as user_type,
         sum(t.estimated_hours)::numeric as open_estimated_hours,
         count(*) filter (where t.estimated_hours is null) as unestimated_open_tasks
    from public.developer_tasks t
   where coalesce(t.status, '') not in ('completed','cancelled')
     and t.developer_id is not null
   group by t.organization_id, t.developer_id
)
select
  w.organization_id,
  w.user_id,
  w.week_start,
  ep.weekly_hours,
  ld.days                                            as leave_days,
  -- NULL, not a guess. See the header.
  case
    when ep.weekly_hours is null then null
    else round(greatest(0, ep.weekly_hours - (ld.days * ep.weekly_hours / 5)), 2)
  end                                                as available_hours,
  round(coalesce(lg.logged_hours, 0), 2)             as logged_hours,
  case
    when ep.weekly_hours is null then null
    else round(
      coalesce(lg.logged_hours, 0)
      / nullif(greatest(0, ep.weekly_hours - (ld.days * ep.weekly_hours / 5)), 0)
      * 100, 0)
  end                                                as utilisation_pct,
  al.allocation_pct,
  coalesce(al.project_count, 0)                      as project_count,
  coalesce(al.allocated_projects, 0)                 as allocated_projects,
  cm.open_estimated_hours,
  coalesce(cm.unestimated_open_tasks, 0)             as unestimated_open_tasks,
  w.user_type
from weeks w
-- Resolve contracted hours only within the same typed profile identity.
left join lateral (
  select ep2.weekly_hours
    from public.employee_profiles ep2
   where ep2.organization_id = w.organization_id
     and ep2.user_id         = w.user_id
     and ep2.user_type       = w.user_type
   order by (ep2.weekly_hours is null), ep2.created_at
   limit 1
) ep on true
left join logged    lg on lg.organization_id = w.organization_id and lg.user_id = w.user_id and lg.user_type = w.user_type and lg.week_start = w.week_start
left join leave_days ld on ld.organization_id = w.organization_id and ld.user_id = w.user_id and ld.user_type = w.user_type and ld.week_start = w.week_start
left join allocated  al on al.organization_id = w.organization_id and al.user_id = w.user_id and al.user_type = w.user_type
left join committed  cm on cm.organization_id = w.organization_id and cm.user_id = w.user_id and cm.user_type = w.user_type;
commit;
