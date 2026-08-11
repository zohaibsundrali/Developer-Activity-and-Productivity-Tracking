-- =====================================================================
--  061 - the four fields a bug needs that a task does not
-- =====================================================================
--
--  WHAT THIS DELIBERATELY DOES NOT DO
--
--  It does not add a bug table, a bug status pipeline, or a test-case manager.
--
--  A bug already IS a `developer_tasks` row with `task_type = 'bug'`, and the
--  status pipeline already expresses the whole lifecycle that was asked for:
--
--      Open        -> pending
--      In Progress -> in_progress
--      Fixed       -> awaiting_approval   (the developer says it is fixed)
--      Retest      -> reviewed            (QA has picked it up)
--      Closed      -> completed           (via the review route)
--      Reopened    -> rejected -> in_progress
--
--  STATUS_TRANSITIONS in src/utils/pmData.js already permits exactly those
--  moves, `rejected -> in_progress` included, and migration 058 already made
--  `qa` a reviewer. A second pipeline would have meant a second set of
--  transitions, a second board, a second rollup into productivity_metrics, and
--  two places for "is this done?" to disagree.
--
--  So the only thing genuinely missing is the information a bug carries and a
--  feature request does not. Four columns.
--
--  ALL NULLABLE, ON PURPOSE
--
--  These are meaningful only when task_type = 'bug'. A NOT NULL or a CHECK
--  requiring them would fail every ordinary task insert in the product, and a
--  conditional constraint (`check (task_type <> 'bug' or severity is not null)`)
--  would reject bugs filed from the existing task screens, which know nothing
--  about these fields. The form asks for them; the table does not force them.
--
--  RUN PART 1, then PART 2 (verification, changes nothing).
--
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 1 - The columns
-- ---------------------------------------------------------------------

alter table public.developer_tasks
  --  How much it hurts. A closed vocabulary rather than free text because the
  --  only thing this field is for is ordering the queue, and "Critical",
  --  "critical!!" and "P1" do not sort together.
  add column if not exists severity text
    check (severity is null or severity in ('critical','major','minor','trivial')),

  --  The single most useful thing a bug report contains, and the thing most
  --  often missing from one. Kept as text rather than a structured list: a
  --  numbered list somebody actually wrote beats a schema they abandoned
  --  halfway through.
  add column if not exists steps_to_reproduce text,

  --  Browser, device, environment, build. Bugs that only happen in one of
  --  those are the ones that cost a day to reproduce.
  add column if not exists environment text,

  --  Who found it. Not necessarily the assignee, and not necessarily staff —
  --  QA, a developer, or a client through the portal.
  add column if not exists reported_by uuid;

--  The bugs queue is "open bugs in this organization, worst first". Without
--  this it is a sequential scan filtered on task_type every time the screen
--  polls.
create index if not exists idx_tasks_org_bugs
  on public.developer_tasks (organization_id, status, severity)
  where task_type = 'bug';


-- ---------------------------------------------------------------------
--  PART 2 - Verification. Changes nothing.
-- ---------------------------------------------------------------------

--  2a. Expect four rows, all is_nullable = YES.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'developer_tasks'
  and column_name in ('severity','steps_to_reproduce','environment','reported_by')
order by column_name;

--  2b. The severity vocabulary is enforced. Expect one row mentioning all four.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.developer_tasks'::regclass
  and pg_get_constraintdef(oid) ilike '%severity%';

--  2c. The partial index exists.
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'developer_tasks'
  and indexname = 'idx_tasks_org_bugs';

--  2d. Nothing existing broke: every task still has a status the pipeline
--      knows. Expect 0 rows.
select status, count(*)
from public.developer_tasks
where status not in ('pending','in_progress','awaiting_approval','reviewed','completed','rejected')
group by status;


-- =====================================================================
--  NO RLS CHANGES
--
--  These are columns on a table that already has its policies. A bug is
--  reachable by exactly the people a task is reachable by, which is correct:
--  the QA engineer who has to fix-verify it and the developer who has to fix
--  it are already on the project.
-- =====================================================================
