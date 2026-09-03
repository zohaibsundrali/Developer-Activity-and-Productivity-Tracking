-- ============================================================================
--  088 - Capacity, measured rather than guessed
--
--  WHAT THE PRODUCT ALREADY SAYS ABOUT ITSELF
--
--  src/utils/orgWorkGraph.js carries this note, and it is honest:
--
--      THE THRESHOLDS ARE A CONVENTION, NOT A MEASUREMENT. Nothing in this
--      product records how long a task takes, so "6 open tasks" is heavy for
--      one person and a quiet week for another.
--
--  The Capacity screen sorts people by open task COUNT and says on screen that
--  the label is a convention. That was the right thing to build when there was
--  nothing better. There is now.
--
--  FOUR THINGS EXISTED AND NONE OF THEM WERE JOINED UP:
--
--    developer_tasks.estimated_hours   016. How long the work is thought to be.
--    project_members.allocation_pct    071. What share of somebody a project is
--                                      meant to have. Added for exactly this and
--                                      never populated by anything.
--    leave_requests (approved)         075. The days somebody will not be here.
--    task_time_logs                    017. What actually happened.
--
--  Supply minus leave, against committed work, against what was really logged.
--  That is a capacity plan. Each of those four numbers already had a home; the
--  only thing genuinely missing is how many hours a week a person is here for.
--
--  weekly_hours IS NULL AND STAYS NULL UNTIL SOMEBODY SAYS.
--
--  Writing 40 would be the single most tempting invention in this whole
--  migration series and the most damaging: every part-timer, every contractor
--  and every intern would be planned as full-time, the numbers would look
--  complete, and nobody would go looking. NULL propagates all the way to the
--  screen, which says "hours not set" rather than showing a plan built on a
--  guess.
--
--  NOTHING HERE BLOCKS OVER-ALLOCATION. Being at 130% is a real and common
--  state — it is the thing a planner most needs to SEE, and a constraint that
--  refused it would simply mean people stopped recording allocations.
--
--  RUN AFTER 087.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - the one missing fact
-- ---------------------------------------------------------------------
--  Contracted hours per week. Nullable, no default. See the header.
--
--  `employee_profiles.work_schedule` (015) is a jsonb {start,end,days} that
--  nothing has ever written or read. It is not reused here: parsing a shape
--  nothing produces, to derive a number, is more ways to be wrong than a column
--  that holds the number.

alter table public.employee_profiles
  add column if not exists weekly_hours numeric(5,2)
    check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 168));


-- ---------------------------------------------------------------------
--  PART 2 - capacity, per person, per week
-- ---------------------------------------------------------------------
--  ONE ROW PER PERSON PER WEEK THEY HAVE ANY TRACE IN. Weeks are generated from
--  the time logs and the leave rather than from a calendar: a view that
--  generated every week since the organization started would be mostly empty
--  rows, and the screen would page through nothing.
--
--  EVERY DERIVED NUMBER IS NULL WHEN weekly_hours IS NULL. That is the whole
--  discipline of this view. `available_hours` is not `40 - leave`; it is
--  unknown, and unknown is a different answer from zero.

create or replace view public.capacity_week_v
  with (security_invoker = true) as
with weeks as (
  -- Every (person, week) with a logged hour...
  select l.organization_id,
         l.developer_id                         as user_id,
         public.timesheet_week_of(l.started_at) as week_start
    from public.task_time_logs l
   where l.seconds is not null
   group by l.organization_id, l.developer_id, public.timesheet_week_of(l.started_at)
  union
  -- ...or an approved day of leave in it. A week somebody spent entirely on
  -- leave has no time logs and is exactly the week a planner needs to see.
  select r.organization_id,
         r.user_id,
         public.timesheet_week_of(r.start_date::timestamptz)
    from public.leave_requests r
   where r.status = 'approved'
),
logged as (
  select l.organization_id,
         l.developer_id as user_id,
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
      and r.status          = 'approved'
      and r.start_date     <= w.week_start + 6
      and r.end_date       >= w.week_start
   group by w.organization_id, w.user_id, w.week_start
),
allocated as (
  -- Share of a person committed to projects that are still running. Summed
  -- across projects, so 130% is expressible — see the header.
  select pm.organization_id,
         pm.user_id,
         sum(pm.allocation_pct)::numeric        as allocation_pct,
         count(*) filter (where pm.allocation_pct is not null) as allocated_projects,
         count(*)                               as project_count
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
   where coalesce(p.status, '') not in ('completed','cancelled','closed')
   group by pm.organization_id, pm.user_id
),
committed as (
  -- Estimated hours still outstanding on open tasks. Not week-scoped: it is a
  -- backlog, and what it answers is "is there more work than time", which has
  -- no week of its own.
  select t.organization_id,
         t.developer_id as user_id,
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
  coalesce(cm.unestimated_open_tasks, 0)             as unestimated_open_tasks
from weeks w
-- LATERAL WITH A LIMIT, not a plain join. `employee_profiles` is unique on
-- (organization_id, user_id, USER_TYPE), so somebody promoted from developer to
-- admin legitimately holds TWO rows — and a plain join would emit two rows per
-- person per week and double every number on this screen. 079 shipped exactly
-- that bug against this same table; it is not making it twice.
--
-- The row carrying a weekly_hours wins, so a stale second profile cannot hide a
-- number somebody actually set.
left join lateral (
  select ep2.weekly_hours
    from public.employee_profiles ep2
   where ep2.organization_id = w.organization_id
     and ep2.user_id         = w.user_id
   order by (ep2.weekly_hours is null), ep2.created_at
   limit 1
) ep on true
left join logged    lg on lg.organization_id = w.organization_id and lg.user_id = w.user_id and lg.week_start = w.week_start
left join leave_days ld on ld.organization_id = w.organization_id and ld.user_id = w.user_id and ld.week_start = w.week_start
left join allocated  al on al.organization_id = w.organization_id and al.user_id = w.user_id
left join committed  cm on cm.organization_id = w.organization_id and cm.user_id = w.user_id;


-- ---------------------------------------------------------------------
--  PART 3 - RLS
-- ---------------------------------------------------------------------
--  No new tables, so no new policies. The view is `security_invoker`, so it
--  reads task_time_logs, leave_requests, project_members, developer_tasks and
--  employee_profiles under each caller's own policies -- which is the whole
--  reason 087 exists.
--
--  Note what that means and is meant to mean: a person with no wide permission
--  sees their OWN row and nothing else, because leave_requests_read and
--  attendance-style own-row clauses already say so. The screen is gated on
--  `capacity.view` (owner, admin, hr, manager, team_lead) on top of that.


-- ---------------------------------------------------------------------
--  PART 4 - verify (read-only)
-- ---------------------------------------------------------------------
--  4a) the column landed, and how much of it is set
select count(*)                       as profiles,
       count(weekly_hours)            as weekly_hours_set
  from public.employee_profiles;

--  4b) the view resolves, and reads as the caller
select count(*) as capacity_rows from public.capacity_week_v;

select coalesce(
         (select option_value
            from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'),
         'NOT SET'
       ) as security_invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'capacity_week_v';

--  4c) how much of the plan is actually knowable today. Expect a lot of nulls
--      on a fresh install -- that is the point, and it is what the screen says
--      rather than papering over.
select count(*)                                as rows,
       count(weekly_hours)                     as with_weekly_hours,
       count(allocation_pct)                   as with_allocation,
       count(open_estimated_hours)             as with_estimates
  from public.capacity_week_v;
