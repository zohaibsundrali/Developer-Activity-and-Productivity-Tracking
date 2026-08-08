-- =====================================================================
--  023 - Columns the notification system has always written
-- =====================================================================
--  WHY THIS EXISTS
--   Seven writers insert `title`, `project_id` and `task_id` into
--   public.notifications:
--     api/admin-review, api/automation/notify, api/cron,
--     api/task-submission, developer/project-details,
--     components/admin/ViewDevelopers, utils/automation
--   None of those three columns exist, so every one of those inserts fails.
--   Task-review notifications, automation notifications and the cron due /
--   overdue reminders have therefore never reached anyone.
--
--   The cron job additionally DEDUPES on task_id, so without the column it
--   cannot tell whether a reminder was already sent today.
--
--  WHY COLUMNS RATHER THAN CODE CHANGES
--   The alternative is stripping the three fields from seven call sites, which
--   would permanently lose the task and project links the UI needs to deep-link
--   a notification, and would degrade reminder dedupe from per-task to
--   per-developer-per-day.
--
--  SAFETY
--   - Purely additive: three nullable columns and one index. Nothing is
--     dropped, altered or backfilled.
--   - No foreign keys. Notifications outlive the tasks and projects they refer
--     to, and an FK would either block those deletes or cascade away the
--     history. The ids are stored as plain uuid references.
--   - Existing rows keep NULL in all three, which is what every reader already
--     tolerates.
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles both.
-- =====================================================================

alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists task_id uuid;
alter table public.notifications add column if not exists project_id uuid;

-- The cron dedupe probe reads (task_id, type, created_at) for today's window.
create index if not exists idx_notifications_task_type_created on public.notifications (task_id, type, created_at desc);

-- =====================================================================
--  VERIFY - expected: three rows (project_id, task_id, title)
-- =====================================================================
-- select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name in ('title','task_id','project_id') order by column_name;
