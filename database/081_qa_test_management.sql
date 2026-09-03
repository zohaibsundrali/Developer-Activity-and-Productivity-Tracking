-- ============================================================================
--  081 - Test cases, test runs, and the defect link
--
--  WHAT 061 ALREADY DECIDED, AND THIS MIGRATION KEEPS
--
--  061 refused to add a bug table or a bug status pipeline, and its reasoning
--  holds: a bug IS a `developer_tasks` row with `task_type = 'bug'`, the status
--  pipeline already expresses the whole lifecycle, and a second one would mean
--  a second set of transitions, a second board, a second rollup into
--  productivity_metrics, and two places for "is this done?" to disagree.
--
--  Nothing here changes that. A defect raised from a failed test is created by
--  the same `createTask(projectId, { task_type: 'bug', ... })` the Bug Queue
--  already uses, and `test_executions.bug_task_id` merely POINTS at it.
--
--  061 also said it was not a test-case manager. That was a statement about
--  scope, not a prohibition, and it named the gap this migration fills: a test
--  case is not a task. A task is done once; a test case is a question you ask
--  again of every build, and its history is the answer changing over time.
--  Modelling it as a task would have given you one row that is simultaneously
--  passed and failed, or a new task per run and no way to see the trend.
--
--  THE THREE TABLES, and why each exists separately:
--
--    test_cases       what to check. Written once, re-used forever.
--    test_runs        an occasion: "regression, build 42". Has a scope and a
--                     moment.
--    test_executions  one case, in one run, with a result. THIS is the row
--                     that carries history — the same case appears once per
--                     run, and the sequence is the trend.
--
--  RUN AFTER 080.
-- ============================================================================


-- ---------------------------------------------------------------------
--  PART 1 - test_cases
-- ---------------------------------------------------------------------
--  `steps` and `expected_result` are text, not a structured list, for the same
--  reason 061 kept steps_to_reproduce as text: a numbered list somebody
--  actually wrote beats a schema they abandoned halfway through.

create table if not exists public.test_cases (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,

  title            text not null,
  preconditions    text,
  steps            text,
  expected_result  text,

  priority         text not null default 'medium'
                     check (priority in ('high','medium','low')),

  -- 'archived' rather than deletion: a case that has been run is part of the
  -- history of every run it appeared in, and deleting it would take the meaning
  -- out of those rows. Archiving keeps it out of NEW runs and leaves the past
  -- readable.
  status           text not null default 'active'
                     check (status in ('draft','active','archived')),

  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists test_cases_project_idx on public.test_cases(project_id, status);
create index if not exists test_cases_org_idx     on public.test_cases(organization_id);


-- ---------------------------------------------------------------------
--  PART 2 - test_runs
-- ---------------------------------------------------------------------

create table if not exists public.test_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,

  name             text not null,
  notes            text,

  status           text not null default 'open'
                     check (status in ('open','closed')),

  created_by       uuid,
  started_at       timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        uuid,

  updated_at       timestamptz not null default now()
);

create index if not exists test_runs_project_idx on public.test_runs(project_id, status);
create index if not exists test_runs_org_idx     on public.test_runs(organization_id);


-- ---------------------------------------------------------------------
--  PART 3 - test_executions
-- ---------------------------------------------------------------------
--  ONE ROW PER CASE PER RUN. The unique constraint is what makes a run a
--  snapshot rather than a log: asking the same question twice in one run and
--  getting two answers is not history, it is ambiguity.
--
--  `bug_task_id` is the whole defect link, and it is a plain nullable FK to
--  developer_tasks. On delete set null: a bug can be deleted and the execution
--  is still a true record that the test failed.

create table if not exists public.test_executions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  run_id           uuid not null references public.test_runs(id) on delete cascade,
  test_case_id     uuid not null references public.test_cases(id) on delete cascade,

  -- 'untested' is the starting state, written when a run is opened, so the run
  -- knows its own scope before anybody has touched it. A run whose rows appear
  -- only as they are executed cannot tell you what is left.
  result           text not null default 'untested'
                     check (result in ('untested','passed','failed','blocked','skipped')),

  notes            text,
  bug_task_id      uuid references public.developer_tasks(id) on delete set null,

  executed_by      uuid,
  executed_at      timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint test_executions_one_per_run unique (run_id, test_case_id),

  -- A PASSING TEST CANNOT CITE A DEFECT. Without this the link is decorative:
  -- a row could say "passed" and point at an open bug, and the QA summary would
  -- count it as green while the defect list counted it as red. 'blocked' is
  -- allowed to carry one — being unable to run a test because something is
  -- broken is exactly a defect worth linking.
  constraint test_executions_bug_only_when_not_passing check (
    bug_task_id is null or result in ('failed','blocked')
  )
);

create index if not exists test_executions_run_idx  on public.test_executions(run_id, result);
create index if not exists test_executions_case_idx on public.test_executions(test_case_id);
create index if not exists test_executions_org_idx  on public.test_executions(organization_id);


-- ---------------------------------------------------------------------
--  PART 4 - a closed run is closed
-- ---------------------------------------------------------------------
--  Same reasoning as the timesheet lock in 077, and for the same structural
--  reason: these tables are reachable from the browser through PostgREST, so a
--  rule enforced only in a route is advisory.
--
--  A closed run is a statement about what was true at a moment. Editing a
--  result after the fact turns it into a statement about now, which is what the
--  NEXT run is for. Reopening is a deliberate act, and it is allowed — the
--  trigger blocks writes to executions, not the run's own status.

create or replace function public.test_run_closed()
returns trigger
language plpgsql
as $$
declare
  v_row    public.test_executions;
  v_status text;
begin
  v_row := coalesce(new, old);

  select r.status into v_status
    from public.test_runs r
   where r.id = v_row.run_id;

  if v_status = 'closed' then
    raise exception
      'That test run is closed. Reopen it before changing results.'
      using errcode = 'check_violation';
  end if;

  return v_row;
end;
$$;

drop trigger if exists trg_test_execution_run_open on public.test_executions;
create trigger trg_test_execution_run_open
  before insert or update or delete
  on public.test_executions
  for each row execute function public.test_run_closed();


-- ---------------------------------------------------------------------
--  PART 5 - a run's result, in one place
-- ---------------------------------------------------------------------
--  Counts rather than a single pass/fail verdict: "27 of 30 passed, 2 failed,
--  1 blocked" is what somebody actually wants, and a boolean would throw away
--  the difference between a failure and a test nobody could run.

create or replace view public.test_run_summary_v as
select
  r.organization_id,
  r.id                                                          as run_id,
  r.project_id,
  r.name,
  r.status,
  r.started_at,
  r.closed_at,
  count(e.id)                                                   as total,
  count(*) filter (where e.result = 'passed')                   as passed,
  count(*) filter (where e.result = 'failed')                   as failed,
  count(*) filter (where e.result = 'blocked')                  as blocked,
  count(*) filter (where e.result = 'skipped')                  as skipped,
  count(*) filter (where e.result = 'untested')                 as untested,
  count(*) filter (where e.bug_task_id is not null)             as defects
from public.test_runs r
left join public.test_executions e on e.run_id = r.id
group by r.organization_id, r.id, r.project_id, r.name, r.status,
         r.started_at, r.closed_at;


-- ---------------------------------------------------------------------
--  PART 6 - RLS
-- ---------------------------------------------------------------------
--  THE ROLE LISTS MIRROR THE CATALOGUE and cannot import it. All four quality
--  keys are the same set today:
--
--    test_case.view / test_case.manage / test_run.manage / test_run.execute
--        owner, admin, manager, team_lead, qa
--
--  THE DESIGN WANTS READING AND EXECUTING TO BE WIDER -- a developer should see
--  what will be checked before calling something finished, and testing is not
--  something QA does alone. That widening is deliberately NOT made yet, and the
--  reason is structural rather than cautious: the three contributor roles
--  cannot enter /admin, so granting them the key would hand them a permission
--  with no screen, and the Quality section being gated on it would have opened
--  the admin FRONT DOOR to all three -- ADMIN_AREA_ROLES is derived by
--  flattening every gated section's role list. A test caught exactly that.
--
--  The widening lands when the staff shell gets a Quality surface.
--
--  What is already settled: writing a CASE stays narrower than running one. A
--  developer editing the test that judges their own work is the shape this
--  module refuses whatever else changes.
--
--  Clients are excluded throughout. A test plan is internal.

alter table public.test_cases      enable row level security;
alter table public.test_runs       enable row level security;
alter table public.test_executions enable row level security;

drop policy if exists test_cases_read on public.test_cases;
create policy test_cases_read on public.test_cases
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false));

drop policy if exists test_cases_write on public.test_cases;
create policy test_cases_write on public.test_cases
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false)
               and public.auth_org_unlocked());

drop policy if exists test_runs_read on public.test_runs;
create policy test_runs_read on public.test_runs
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false));

drop policy if exists test_runs_write on public.test_runs;
create policy test_runs_write on public.test_runs
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false)
               and public.auth_org_unlocked());

drop policy if exists test_executions_read on public.test_executions;
create policy test_executions_read on public.test_executions
  for select to authenticated
  using (organization_id = public.auth_org()
         and not public.auth_is_client()
         and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false));

--  RECORDING A RESULT is the wide one: anybody on delivery may run a test.
drop policy if exists test_executions_write on public.test_executions;
create policy test_executions_write on public.test_executions
  for all to authenticated
  using       (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false))
  with check  (organization_id = public.auth_org()
               and not public.auth_is_client()
               and coalesce(public.auth_role() in ('owner','admin','manager','team_lead','qa'), false)
               and public.auth_org_unlocked());


-- ---------------------------------------------------------------------
--  PART 7 - verify (read-only)
-- ---------------------------------------------------------------------
--  7a) the three tables exist with RLS on
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('test_cases','test_runs','test_executions')
 order by c.relname;

--  7b) the summary view resolves
select count(*) as run_rows from public.test_run_summary_v;

--  7c) no passing execution cites a defect. Expect zero rows -- the CHECK
--      makes it impossible, so this is a check on the constraint.
select id, result, bug_task_id
  from public.test_executions
 where bug_task_id is not null
   and result not in ('failed','blocked');
