-- =====================================================================
--  021 — Workflow integrity: a terminal task status must come from review
-- =====================================================================
--  WHY THIS EXISTS
--   `completed` and `rejected` are not just column values: they are the
--   recorded outcome of a review. The review route stamps is_on_time,
--   productivity_points, actual_completion_date, reviewed_by/reviewed_at,
--   writes admin_reviews, recomputes productivity_metrics and notifies the
--   developer. Every board drag, status dropdown and automation instead ran a
--   bare update({status}), so a card dropped in "Done" produced a completed
--   task with no submission, no review, no points and a project progress
--   number that counted work nobody checked.
--
--   The application now routes both statuses through /api/admin-review. This
--   file is the database backstop for anything that does not: reaching a
--   terminal status requires a review timestamp, which only the review path
--   writes.
--
--  FORMAT NOTE: one statement per physical line, no DO/$$ blocks — the target
--  SQL editor splits input on newlines and semicolons.
--
--  SAFETY
--   - Additive only: one data backfill plus one CHECK constraint. No table,
--     column, policy or trigger is dropped or altered.
--   - The backfill stamps historical terminal rows that never went through
--     review, so the constraint cannot block ordinary edits (title, dates,
--     labels) to work that closed before this migration.
--   - The constraint is added NOT VALID: Postgres enforces it on every insert
--     and update from now on, without re-validating the whole table.
--   - reviewed_by is deliberately NOT part of the check — it can legitimately
--     be null for a reviewer whose app user id is not resolvable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Backfill: give already-closed tasks a review timestamp.
-- ---------------------------------------------------------------------
update public.developer_tasks set reviewed_at = coalesce(reviewed_at, updated_at, created_at, now()) where status in ('completed', 'rejected') and reviewed_at is null;

-- ---------------------------------------------------------------------
-- 2. Enforce the invariant going forward.
-- ---------------------------------------------------------------------
alter table public.developer_tasks drop constraint if exists developer_tasks_terminal_status_reviewed_check;
alter table public.developer_tasks add constraint developer_tasks_terminal_status_reviewed_check check (status not in ('completed', 'rejected') or reviewed_at is not null) not valid;

-- ---------------------------------------------------------------------
-- 3. Documentation of the pipeline the constraint protects.
-- ---------------------------------------------------------------------
comment on constraint developer_tasks_terminal_status_reviewed_check on public.developer_tasks is 'pending -> in_progress -> awaiting_approval -> [reviewed] -> completed/rejected. The two terminal statuses are written only by the admin review flow, which always sets reviewed_at.';

-- ---------------------------------------------------------------------
-- VERIFY (run separately)
--   select status, count(*) from public.developer_tasks where reviewed_at is null group by status;
--   -> no completed/rejected rows should appear.
-- ---------------------------------------------------------------------
