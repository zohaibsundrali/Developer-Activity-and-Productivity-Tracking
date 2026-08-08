-- =====================================================================
--  024 - Workflow state constraints
-- =====================================================================
--  Phase 3. Database backstops for state invariants the application checks but
--  cannot guarantee, because every one of those checks is a read followed by a
--  write and nothing stops two concurrent callers passing the read.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles both. Statements that ADD a
--  column or constraint are kept in a different PART from statements that
--  REFERENCE it, because that editor resolves an entire paste before running
--  any of it.
--
--  Run each PART as its own query. The editor wraps a paste in ONE transaction,
--  so a failure costs one part rather than all of them.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PART 0 - PRE-FLIGHT (read-only). Run this first.
-- ---------------------------------------------------------------------
--  PART 3 widens the review_status CHECK by dropping it by its conventional
--  name. If this returns a constraint whose name is NOT
--  task_submissions_review_status_check, report it instead of running PART 3 -
--  the old constraint would survive and reject the new value.

-- select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.task_submissions'::regclass and contype = 'c';


-- ---------------------------------------------------------------------
--  PART 1 - One running timer per developer
-- ---------------------------------------------------------------------
--  startTaskTimer stops any running timer before inserting a new one, but that
--  is a read-then-write: two tabs, a double click, or a retried request all
--  pass the read and insert twice. The result is two open rows whose elapsed
--  time both keep counting, so tracked hours inflate silently.
--
--  The update closes every open timer that already has a NEWER open timer for
--  the same developer, leaving exactly one. It must run before the index, which
--  would otherwise fail on the existing duplicates.

update public.task_time_logs t set ended_at = now(), seconds = greatest(0, round(extract(epoch from (now() - t.started_at)))::int) where t.ended_at is null and exists (select 1 from public.task_time_logs n where n.developer_id = t.developer_id and n.ended_at is null and n.started_at > t.started_at);

create unique index if not exists uq_time_logs_one_active_per_dev on public.task_time_logs (developer_id) where ended_at is null;


-- ---------------------------------------------------------------------
--  PART 2 - The notification column the review flow still writes
-- ---------------------------------------------------------------------
--  Migration 023 added title / task_id / project_id, but the approve, reject
--  and submit-for-review notifications also write submission_id, so those three
--  inserts still fail and none of them reach anyone. Adding the column is what
--  makes 023 actually take effect for the review flow.

alter table public.notifications add column if not exists submission_id uuid;

--  The type CHECK declared in schema.sql permits eight values, but the running
--  code writes due_reminder, automation, task_assigned, success, info and
--  warning as well - none of which are in it. The constraint describes an older
--  design than the one shipping, so it is dropped rather than extended each
--  time a workflow event is added.
alter table public.notifications drop constraint if exists notifications_type_check;


-- ---------------------------------------------------------------------
--  PART 3 - Widen review_status, then enforce one open submission per task
-- ---------------------------------------------------------------------
--  A task must not have two submissions awaiting review at once: a reviewer
--  approves one while the other stays pending forever, and the task keeps
--  looking unreviewed after it closed.
--
--  Existing duplicates are collapsed by superseding all but the newest.
--  'superseded' is not in the original CHECK, so the constraint is widened
--  first. Widening only ADDS a permitted value - nothing previously valid
--  becomes invalid. Run PART 0 first to confirm the constraint name.

alter table public.task_submissions drop constraint if exists task_submissions_review_status_check;
alter table public.task_submissions add constraint task_submissions_review_status_check check (review_status in ('pending', 'approved', 'rejected', 'superseded'));


-- ---------------------------------------------------------------------
--  PART 4 - Collapse duplicates and add the index (AFTER part 3)
-- ---------------------------------------------------------------------

update public.task_submissions s set review_status = 'superseded' where s.review_status = 'pending' and exists (select 1 from public.task_submissions n where n.task_id = s.task_id and n.review_status = 'pending' and n.submitted_at > s.submitted_at);

create unique index if not exists uq_task_submissions_one_pending on public.task_submissions (task_id) where review_status = 'pending';


-- =====================================================================
--  VERIFY (read-only, run separately). Expected: 0, 0, then two rows.
-- =====================================================================
-- select count(*) as developers_with_multiple_open_timers from (select developer_id from public.task_time_logs where ended_at is null group by developer_id having count(*) > 1) x;
-- select count(*) as tasks_with_multiple_pending_submissions from (select task_id from public.task_submissions where review_status = 'pending' group by task_id having count(*) > 1) x;
-- select indexname from pg_indexes where schemaname = 'public' and indexname in ('uq_time_logs_one_active_per_dev','uq_task_submissions_one_pending') order by indexname;
