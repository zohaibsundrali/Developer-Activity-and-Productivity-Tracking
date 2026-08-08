-- =====================================================================
--  RUN ME - Phases 2 to 5 database changes, in order
-- =====================================================================
--  Combines migrations 020, 021, 023 and 022. Run each STEP separately, in the
--  order given. The Supabase SQL editor wraps whatever you paste in ONE
--  transaction, so a single failing statement rolls that whole step back -
--  running step by step means a failure costs you one step, not all of them.
--
--  Every statement sits on ONE PHYSICAL LINE with no double-quoted
--  identifiers, because the editor mangles both.
--
--  STEP 0 is a read-only safety check. Run it first and expect zero rows.
-- =====================================================================


-- =====================================================================
--  STEP 0 - PRE-FLIGHT (read-only, changes nothing)
--  Expected result: ZERO ROWS. Any row is a column STEP 4 expects but this
--  database does not have. Report it rather than running STEP 4.
-- =====================================================================

with needed(t, c) as (values ('activity_logs','created_at'), ('activity_logs','developer_id'), ('activity_logs','organization_id'), ('activity_logs','task_id'), ('announcements','organization_id'), ('announcements','published_at'), ('app_usage','session_id'), ('app_usage','start_time'), ('app_usage','tracked_at'), ('app_usage','user_email'), ('approvals','created_at'), ('approvals','organization_id'), ('clients','created_at'), ('clients','organization_id'), ('developer_tasks','created_at'), ('developer_tasks','developer_id'), ('developer_tasks','due_date'), ('developer_tasks','is_recurring'), ('developer_tasks','organization_id'), ('developer_tasks','project_id'), ('developer_tasks','reviewed_at'), ('developer_tasks','status'), ('developer_tasks','task_order'), ('developer_tasks','updated_at'), ('invoices','created_at'), ('invoices','organization_id'), ('keyboard_stats','developer_id'), ('keyboard_stats','session_id'), ('keyboard_stats','tracked_at'), ('keyboard_stats','user_email'), ('mouse_activities','developer_id'), ('mouse_activities','session_id'), ('mouse_activities','timestamp'), ('notifications','admin_id'), ('notifications','created_at'), ('notifications','developer_id'), ('notifications','organization_id'), ('notifications','read'), ('pm_activity','created_at'), ('pm_activity','organization_id'), ('productivity_metrics','developer_id'), ('productivity_metrics','organization_id'), ('productivity_sessions','created_at'), ('productivity_sessions','session_id'), ('productivity_sessions','start_time'), ('productivity_sessions','user_email'), ('project_clients','created_at'), ('project_clients','organization_id'), ('projects','archived'), ('projects','assigned_developer_id'), ('projects','created_at'), ('projects','organization_id'), ('projects','updated_at'), ('screenshots','created_at'), ('screenshots','developer_email'), ('screenshots','developer_id'), ('screenshots','timestamp'), ('support_messages','created_at'), ('support_messages','thread_id'), ('support_threads','last_message_at'), ('support_threads','organization_id'), ('task_submissions','developer_id'), ('task_submissions','organization_id'), ('task_submissions','project_id'), ('task_submissions','submitted_at'), ('task_time_logs','developer_id'), ('task_time_logs','organization_id'), ('task_time_logs','project_id'), ('task_time_logs','started_at')) select n.t as table_name, n.c as missing_column from needed n left join information_schema.columns ic on ic.table_schema = 'public' and ic.table_name = n.t and ic.column_name = n.c where ic.column_name is null order by 1, 2;



-- =====================================================================
--  STEP 1 - Tenant-isolated file storage
--  Private `org-files` bucket for employee photos and project documents, plus
--  write policies on the still-public `documents` bucket. Safe to run any time.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit) values ('org-files', 'org-files', false, 26214400) on conflict (id) do update set public = false, file_size_limit = 26214400;
drop policy if exists org_files_read on storage.objects;
drop policy if exists org_files_insert on storage.objects;
drop policy if exists org_files_update on storage.objects;
drop policy if exists org_files_delete on storage.objects;
create policy org_files_read on storage.objects for select to authenticated using (bucket_id = 'org-files' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text and ((storage.foldername(name))[2] <> 'employee-photos' or public.auth_role() in ('owner','admin','hr') or (storage.foldername(name))[3] = public.auth_app_user_id()::text));
create policy org_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'org-files' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text);
create policy org_files_update on storage.objects for update to authenticated using (bucket_id = 'org-files' and not public.auth_is_client() and (storage.foldername(name))[1] = public.auth_org()::text) with check (bucket_id = 'org-files' and (storage.foldername(name))[1] = public.auth_org()::text);
create policy org_files_delete on storage.objects for delete to authenticated using (bucket_id = 'org-files' and public.auth_role() in ('owner','admin','hr') and (storage.foldername(name))[1] = public.auth_org()::text);
drop policy if exists documents_insert on storage.objects;
drop policy if exists documents_update on storage.objects;
drop policy if exists documents_delete on storage.objects;
create policy documents_insert on storage.objects for insert to authenticated with check (bucket_id = 'documents' and not public.auth_is_client());
create policy documents_update on storage.objects for update to authenticated using (bucket_id = 'documents' and not public.auth_is_client()) with check (bucket_id = 'documents');
create policy documents_delete on storage.objects for delete to authenticated using (bucket_id = 'documents' and public.auth_role() in ('owner','admin','hr'));


-- =====================================================================
--  STEP 2 - Workflow integrity
--  Backfills reviewed_at on already-closed tasks, then adds a NOT VALID CHECK so
--  a task cannot reach completed/rejected without going through review.
--  This one WRITES DATA.
-- =====================================================================
update public.developer_tasks set reviewed_at = coalesce(reviewed_at, updated_at, created_at, now()) where status in ('completed', 'rejected') and reviewed_at is null;
alter table public.developer_tasks drop constraint if exists developer_tasks_terminal_status_reviewed_check;
alter table public.developer_tasks add constraint developer_tasks_terminal_status_reviewed_check check (status not in ('completed', 'rejected') or reviewed_at is not null) not valid;
comment on constraint developer_tasks_terminal_status_reviewed_check on public.developer_tasks is 'pending -> in_progress -> awaiting_approval -> [reviewed] -> completed/rejected. The two terminal statuses are written only by the admin review flow, which always sets reviewed_at.';


-- =====================================================================
--  STEP 3 - Notification columns
--  Adds title / task_id / project_id, which seven writers already insert and no
--  version of this table has ever had. Run this BEFORE step 4.
-- =====================================================================
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists task_id uuid;
alter table public.notifications add column if not exists project_id uuid;
create index if not exists idx_notifications_task_type_created on public.notifications (task_id, type, created_at desc);


-- =====================================================================
--  STEP 4 - Performance indexes
--  45 composite indexes. RUN STEP 0 FIRST. These builds hold a write-blocking
--  lock for their duration, so prefer a quiet window.
-- =====================================================================
create index if not exists idx_dev_tasks_org_project on public.developer_tasks (organization_id, project_id);
create index if not exists idx_dev_tasks_org_developer on public.developer_tasks (organization_id, developer_id);
create index if not exists idx_dev_tasks_org_status on public.developer_tasks (organization_id, status);
create index if not exists idx_dev_tasks_org_due on public.developer_tasks (organization_id, due_date);
create index if not exists idx_dev_tasks_org_created on public.developer_tasks (organization_id, created_at desc);
create index if not exists idx_dev_tasks_project_order on public.developer_tasks (project_id, task_order);
create index if not exists idx_dev_tasks_developer_updated on public.developer_tasks (developer_id, updated_at desc);
create index if not exists idx_dev_tasks_due_date on public.developer_tasks (due_date);
create index if not exists idx_dev_tasks_recurring on public.developer_tasks (due_date) where is_recurring = true;
create index if not exists idx_time_logs_org_started on public.task_time_logs (organization_id, started_at desc);
create index if not exists idx_time_logs_org_dev_started on public.task_time_logs (organization_id, developer_id, started_at desc);
create index if not exists idx_time_logs_org_proj_started on public.task_time_logs (organization_id, project_id, started_at desc);
create index if not exists idx_task_submissions_org_project on public.task_submissions (organization_id, project_id, submitted_at desc);
create index if not exists idx_task_submissions_org_dev on public.task_submissions (organization_id, developer_id, submitted_at desc);
create index if not exists idx_projects_org_created on public.projects (organization_id, created_at desc);
create index if not exists idx_projects_org_archived_created on public.projects (organization_id, archived, created_at desc);
create index if not exists idx_projects_assigned_dev_updated on public.projects (assigned_developer_id, updated_at desc);
create index if not exists idx_notifications_org_read on public.notifications (organization_id, read);
create index if not exists idx_notifications_developer_created on public.notifications (developer_id, created_at desc);
create index if not exists idx_notifications_admin_created on public.notifications (admin_id, created_at desc);
create index if not exists idx_pm_activity_org_created on public.pm_activity (organization_id, created_at desc);
create index if not exists idx_activity_logs_org_created on public.activity_logs (organization_id, created_at desc);
create index if not exists idx_activity_logs_dev_created on public.activity_logs (developer_id, created_at desc);
create index if not exists idx_activity_logs_task_created on public.activity_logs (task_id, created_at desc);
create index if not exists idx_productivity_metrics_org_dev on public.productivity_metrics (organization_id, developer_id);
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
create index if not exists idx_screenshots_dev_ts on public.screenshots (developer_id, timestamp desc);
create index if not exists idx_screenshots_email_ts on public.screenshots (developer_email, timestamp desc);
create index if not exists idx_screenshots_dev_created on public.screenshots (developer_id, created_at desc);
create index if not exists idx_clients_org_created on public.clients (organization_id, created_at desc);
create index if not exists idx_project_clients_org_created on public.project_clients (organization_id, created_at desc);
create index if not exists idx_announcements_org_published on public.announcements (organization_id, published_at desc);
create index if not exists idx_invoices_org_created on public.invoices (organization_id, created_at desc);
create index if not exists idx_approvals_org_created on public.approvals (organization_id, created_at desc);
create index if not exists idx_support_threads_org_last_msg on public.support_threads (organization_id, last_message_at desc);
create index if not exists idx_support_messages_thread_created on public.support_messages (thread_id, created_at);


-- =====================================================================
--  STEP 5 - VERIFY (read-only)
-- =====================================================================
select policyname, cmd, roles::text from pg_policies where schemaname = 'storage' and (policyname like 'org_files%' or policyname like 'documents%' or policyname like 'monitoring%') order by policyname;
select count(*) as unreviewed_terminal from public.developer_tasks where reviewed_at is null and status in ('completed','rejected');
select count(*) as notification_columns_added from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name in ('title','task_id','project_id');
select count(*) as new_indexes from pg_indexes where schemaname = 'public' and indexname like 'idx_%';

