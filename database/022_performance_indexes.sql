-- =====================================================================
--  022 - Performance hardening: composite indexes for the hot query shapes
-- =====================================================================
--  Fixes the audit finding that every multi-tenant table is filtered by
--  organization_id PLUS a second column (developer_id / project_id / task_id /
--  a timestamp) while only a single-column organization_id index exists. A
--  single-column index forces Postgres to fetch and re-filter every row in the
--  organization; on the tracking tables that is the whole day's telemetry on
--  a 10-second dashboard poll.
--
--  Every index below corresponds to a query shape that actually exists in
--  src/ - the leading columns match the .eq() filters and the trailing column
--  matches the .order()/.gte() the same query uses, so the index can satisfy
--  both the filter and the sort.
--
--  The desktop-tracking tables (screenshots, keyboard_stats, mouse_activities,
--  app_usage, productivity_sessions) are indexed on developer identity + time
--  rather than organization_id on purpose: the desktop writers insert with the
--  service role and never populate organization_id, so the website scopes them
--  by developer id / email instead (see src/utils/reportsData.js).
--
--  FORMAT NOTE: one statement per physical line, no DO blocks, no double-quoted
--  identifiers - the target SQL editor mangles all three.
--
--  IMPORTANT: the Supabase SQL editor runs the whole script in ONE TRANSACTION,
--  so CREATE INDEX CONCURRENTLY is illegal here. On a large table these builds
--  take an ACCESS SHARE-blocking lock for their duration - run during a quiet
--  window, or re-issue the individual statements with CONCURRENTLY outside a
--  transaction if the tables have grown past a few million rows.
-- =====================================================================

-- ---------------------------------------------------------------------
--  developer_tasks - the busiest org-scoped table (reports, board, cron)
-- ---------------------------------------------------------------------
create index if not exists idx_dev_tasks_org_project on public.developer_tasks (organization_id, project_id);
create index if not exists idx_dev_tasks_org_developer on public.developer_tasks (organization_id, developer_id);
create index if not exists idx_dev_tasks_org_status on public.developer_tasks (organization_id, status);
create index if not exists idx_dev_tasks_org_due on public.developer_tasks (organization_id, due_date);
create index if not exists idx_dev_tasks_org_created on public.developer_tasks (organization_id, created_at desc);
create index if not exists idx_dev_tasks_project_order on public.developer_tasks (project_id, task_order);
create index if not exists idx_dev_tasks_developer_updated on public.developer_tasks (developer_id, updated_at desc);

-- The cron worker scans due dates org-wide, and separately the recurring
-- templates, which are a tiny fraction of the table - hence the partial index.
create index if not exists idx_dev_tasks_due_date on public.developer_tasks (due_date);
create index if not exists idx_dev_tasks_recurring on public.developer_tasks (due_date) where is_recurring = true;

-- ---------------------------------------------------------------------
--  task_time_logs - reports read a date window per org, per dev, per project
-- ---------------------------------------------------------------------
create index if not exists idx_time_logs_org_started on public.task_time_logs (organization_id, started_at desc);
create index if not exists idx_time_logs_org_dev_started on public.task_time_logs (organization_id, developer_id, started_at desc);
create index if not exists idx_time_logs_org_proj_started on public.task_time_logs (organization_id, project_id, started_at desc);

-- ---------------------------------------------------------------------
--  task_submissions - client portal lists deliverables newest-first
-- ---------------------------------------------------------------------
create index if not exists idx_task_submissions_org_project on public.task_submissions (organization_id, project_id, submitted_at desc);
create index if not exists idx_task_submissions_org_dev on public.task_submissions (organization_id, developer_id, submitted_at desc);

-- ---------------------------------------------------------------------
--  projects - almost every screen is (org, archived) ordered by created_at
-- ---------------------------------------------------------------------
create index if not exists idx_projects_org_created on public.projects (organization_id, created_at desc);
create index if not exists idx_projects_org_archived_created on public.projects (organization_id, archived, created_at desc);
create index if not exists idx_projects_assigned_dev_updated on public.projects (assigned_developer_id, updated_at desc);

-- ---------------------------------------------------------------------
--  notifications - unread badges, per-recipient feeds, and the cron dedupe
--  probe (which previously ran one query per due task)
-- ---------------------------------------------------------------------
create index if not exists idx_notifications_org_read on public.notifications (organization_id, read);
create index if not exists idx_notifications_developer_created on public.notifications (developer_id, created_at desc);
create index if not exists idx_notifications_admin_created on public.notifications (admin_id, created_at desc);

-- ---------------------------------------------------------------------
--  pm_activity / activity_logs - append-only feeds, always read newest-first
-- ---------------------------------------------------------------------
create index if not exists idx_pm_activity_org_created on public.pm_activity (organization_id, created_at desc);
create index if not exists idx_activity_logs_org_created on public.activity_logs (organization_id, created_at desc);
create index if not exists idx_activity_logs_dev_created on public.activity_logs (developer_id, created_at desc);
create index if not exists idx_activity_logs_task_created on public.activity_logs (task_id, created_at desc);

-- ---------------------------------------------------------------------
--  productivity_metrics - team stats roll up per developer within an org
-- ---------------------------------------------------------------------
create index if not exists idx_productivity_metrics_org_dev on public.productivity_metrics (organization_id, developer_id);

-- ---------------------------------------------------------------------
--  Desktop tracking tables - identity + time, the 10s dashboard poll path
-- ---------------------------------------------------------------------
create index if not exists idx_sessions_email_start on public.productivity_sessions (user_email, start_time desc);
create index if not exists idx_sessions_email_created on public.productivity_sessions (user_email, created_at desc);
create index if not exists idx_sessions_email_session on public.productivity_sessions (user_email, session_id);

create index if not exists idx_keyboard_stats_dev_tracked on public.keyboard_stats (developer_id, tracked_at desc);
create index if not exists idx_keyboard_stats_email_tracked on public.keyboard_stats (user_email, tracked_at desc);
create index if not exists idx_keyboard_stats_session_tracked on public.keyboard_stats (session_id, tracked_at desc);

create index if not exists idx_mouse_activities_dev_ts on public.mouse_activities (developer_id, timestamp desc);
create index if not exists idx_mouse_activities_session_ts on public.mouse_activities (session_id, timestamp desc);

create index if not exists idx_app_usage_email_tracked on public.app_usage (user_email, tracked_at desc);
create index if not exists idx_app_usage_session_start on public.app_usage (session_id, start_time);

-- Screenshots are read by developer id OR email, and the reader falls back to
-- created_at for legacy rows that never got a timestamp.
create index if not exists idx_screenshots_dev_ts on public.screenshots (developer_id, timestamp desc);
create index if not exists idx_screenshots_email_ts on public.screenshots (developer_email, timestamp desc);
create index if not exists idx_screenshots_dev_created on public.screenshots (developer_id, created_at desc);

-- ---------------------------------------------------------------------
--  Client portal - the management screen loads six org-scoped lists at once
-- ---------------------------------------------------------------------
create index if not exists idx_clients_org_created on public.clients (organization_id, created_at desc);
create index if not exists idx_project_clients_org_created on public.project_clients (organization_id, created_at desc);
create index if not exists idx_announcements_org_published on public.announcements (organization_id, published_at desc);
create index if not exists idx_invoices_org_created on public.invoices (organization_id, created_at desc);
create index if not exists idx_approvals_org_created on public.approvals (organization_id, created_at desc);
create index if not exists idx_support_threads_org_last_msg on public.support_threads (organization_id, last_message_at desc);
create index if not exists idx_support_messages_thread_created on public.support_messages (thread_id, created_at);

-- ---------------------------------------------------------------------
--  NOT INDEXED - the column does not exist in this database
--   notifications.task_id and productivity_sessions.developer_id were both
--   confirmed absent by the STEP 0 pre-flight. Indexing them aborts the whole
--   step, so they are omitted here. Both are referenced by application code
--   that therefore cannot be working - see the note in RUN_ME_phase2to5.sql.
--   Add these two once the columns exist:
--     create index if not exists idx_notifications_task_type_created on public.notifications (task_id, type, created_at desc);
--     create index if not exists idx_sessions_dev_start on public.productivity_sessions (developer_id, start_time desc);
-- ---------------------------------------------------------------------

-- =====================================================================
--  VERIFY - expected: every index above, all with idx_ names
-- =====================================================================
-- select tablename, indexname from pg_indexes where schemaname = 'public' and indexname like 'idx_%' order by tablename, indexname;

-- =====================================================================
--  DELIBERATELY NOT INDEXED
--   developer_logins - the readers in src/ try eight different column shapes
--   (login_time / created_at / developer_email / user_email / email), which
--   means the column set is not stable across deployments. Indexing a column
--   that does not exist would abort this whole migration. Add
--   (developer_id, login_time desc) by hand once the shape is confirmed.
--
--   productivity_sessions.user_id - same reason: migration 011 probes for it
--   with information_schema rather than assuming it exists.
-- =====================================================================
