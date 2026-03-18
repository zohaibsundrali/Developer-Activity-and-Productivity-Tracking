-- =====================================================
-- CASCADE DELETION FIX FOR DEVELOPER REMOVAL
-- Execute these SQL statements in Supabase SQL Editor
-- =====================================================

-- This script updates all foreign key constraints to use CASCADE deletion
-- When a developer is deleted, all related data will be automatically removed

-- =====================================================
-- STEP 1: Drop existing foreign key constraints
-- =====================================================

-- Drop constraints from projects table
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_assigned_to_fkey,
  DROP CONSTRAINT IF EXISTS projects_assigned_developer_id_fkey;

-- Drop constraints from developer_tasks table
ALTER TABLE developer_tasks
  DROP CONSTRAINT IF EXISTS developer_tasks_developer_id_fkey,
  DROP CONSTRAINT IF EXISTS developer_tasks_project_id_fkey;

-- Drop constraints from task_submissions table
ALTER TABLE task_submissions
  DROP CONSTRAINT IF EXISTS task_submissions_developer_id_fkey,
  DROP CONSTRAINT IF EXISTS task_submissions_project_id_fkey,
  DROP CONSTRAINT IF EXISTS task_submissions_task_id_fkey;

-- Drop constraints from productivity_metrics table
ALTER TABLE productivity_metrics
  DROP CONSTRAINT IF EXISTS productivity_metrics_developer_id_fkey,
  DROP CONSTRAINT IF EXISTS productivity_metrics_project_id_fkey;

-- Drop constraints from activity_logs table
ALTER TABLE activity_logs
  DROP CONSTRAINT IF EXISTS activity_logs_developer_id_fkey,
  DROP CONSTRAINT IF EXISTS activity_logs_project_id_fkey,
  DROP CONSTRAINT IF EXISTS activity_logs_task_id_fkey;

-- Drop constraints from admin_reviews table
ALTER TABLE admin_reviews
  DROP CONSTRAINT IF EXISTS admin_reviews_developer_id_fkey,
  DROP CONSTRAINT IF EXISTS admin_reviews_project_id_fkey,
  DROP CONSTRAINT IF EXISTS admin_reviews_task_id_fkey,
  DROP CONSTRAINT IF EXISTS admin_reviews_submission_id_fkey;

-- Drop constraints from notifications table
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_developer_id_fkey,
  DROP CONSTRAINT IF EXISTS notifications_project_id_fkey,
  DROP CONSTRAINT IF EXISTS notifications_task_id_fkey,
  DROP CONSTRAINT IF EXISTS notifications_submission_id_fkey;

-- =====================================================
-- STEP 2: Re-add constraints with CASCADE deletion
-- =====================================================

-- PROJECTS TABLE
-- When developer is deleted → all their projects are deleted
ALTER TABLE projects
  ADD CONSTRAINT projects_assigned_to_fkey
  FOREIGN KEY (assigned_to)
  REFERENCES developers(id)
  ON DELETE CASCADE;

-- DEVELOPER_TASKS TABLE
-- When developer is deleted → all their tasks are deleted
-- When project is deleted → all its tasks are deleted
ALTER TABLE developer_tasks
  ADD CONSTRAINT developer_tasks_developer_id_fkey
  FOREIGN KEY (developer_id)
  REFERENCES developers(id)
  ON DELETE CASCADE;

ALTER TABLE developer_tasks
  ADD CONSTRAINT developer_tasks_project_id_fkey
  FOREIGN KEY (project_id)
  REFERENCES projects(id)
  ON DELETE CASCADE;

-- TASK_SUBMISSIONS TABLE
-- When developer is deleted → all their submissions are deleted
-- When project is deleted → all submissions for that project are deleted
-- When task is deleted → all submissions for that task are deleted
ALTER TABLE task_submissions
  ADD CONSTRAINT task_submissions_developer_id_fkey
  FOREIGN KEY (developer_id)
  REFERENCES developers(id)
  ON DELETE CASCADE;

ALTER TABLE task_submissions
  ADD CONSTRAINT task_submissions_project_id_fkey
  FOREIGN KEY (project_id)
  REFERENCES projects(id)
  ON DELETE CASCADE;

ALTER TABLE task_submissions
  ADD CONSTRAINT task_submissions_task_id_fkey
  FOREIGN KEY (task_id)
  REFERENCES developer_tasks(id)
  ON DELETE CASCADE;

-- PRODUCTIVITY_METRICS TABLE
-- When developer is deleted → all their productivity metrics are deleted
-- When project is deleted → all metrics for that project are deleted
ALTER TABLE productivity_metrics
  ADD CONSTRAINT productivity_metrics_developer_id_fkey
  FOREIGN KEY (developer_id)
  REFERENCES developers(id)
  ON DELETE CASCADE;

ALTER TABLE productivity_metrics
  ADD CONSTRAINT productivity_metrics_project_id_fkey
  FOREIGN KEY (project_id)
  REFERENCES projects(id)
  ON DELETE CASCADE;

-- ACTIVITY_LOGS TABLE
-- When developer is deleted → all their activity logs are deleted
-- When project is deleted → all logs for that project are deleted
-- When task is deleted → all logs for that task are deleted
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_developer_id_fkey
  FOREIGN KEY (developer_id)
  REFERENCES developers(id)
  ON DELETE CASCADE;

ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_project_id_fkey
  FOREIGN KEY (project_id)
  REFERENCES projects(id)
  ON DELETE CASCADE;

ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_task_id_fkey
  FOREIGN KEY (task_id)
  REFERENCES developer_tasks(id)
  ON DELETE CASCADE;

-- ADMIN_REVIEWS TABLE
-- When developer is deleted → all reviews for that developer are deleted
-- When project is deleted → all reviews for that project are deleted
-- When task is deleted → all reviews for that task are deleted
ALTER TABLE admin_reviews
  ADD CONSTRAINT admin_reviews_developer_id_fkey
  FOREIGN KEY (developer_id)
  REFERENCES developers(id)
  ON DELETE CASCADE;

ALTER TABLE admin_reviews
  ADD CONSTRAINT admin_reviews_project_id_fkey
  FOREIGN KEY (project_id)
  REFERENCES projects(id)
  ON DELETE CASCADE;

ALTER TABLE admin_reviews
  ADD CONSTRAINT admin_reviews_task_id_fkey
  FOREIGN KEY (task_id)
  REFERENCES developer_tasks(id)
  ON DELETE CASCADE;

ALTER TABLE admin_reviews
  ADD CONSTRAINT admin_reviews_submission_id_fkey
  FOREIGN KEY (submission_id)
  REFERENCES task_submissions(id)
  ON DELETE CASCADE;

-- NOTIFICATIONS TABLE
-- When developer is deleted → all their notifications are deleted
-- When project is deleted → all notifications for that project are deleted
-- When task is deleted → all notifications for that task are deleted
ALTER TABLE notifications
  ADD CONSTRAINT notifications_developer_id_fkey
  FOREIGN KEY (developer_id)
  REFERENCES developers(id)
  ON DELETE CASCADE;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_project_id_fkey
  FOREIGN KEY (project_id)
  REFERENCES projects(id)
  ON DELETE CASCADE;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_task_id_fkey
  FOREIGN KEY (task_id)
  REFERENCES developer_tasks(id)
  ON DELETE CASCADE;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_submission_id_fkey
  FOREIGN KEY (submission_id)
  REFERENCES task_submissions(id)
  ON DELETE CASCADE;

-- =====================================================
-- STEP 3: Verify constraints are properly set
-- =====================================================

-- View all foreign key constraints to verify CASCADE is set
SELECT
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    confrelid::regclass AS referenced_table,
    confdeltype AS on_delete_action
FROM pg_constraint
WHERE contype = 'f'
  AND connamespace = 'public'::regnamespace
  AND (
    conrelid::regclass::text IN (
      'projects',
      'developer_tasks',
      'task_submissions',
      'productivity_metrics',
      'activity_logs',
      'admin_reviews',
      'notifications'
    )
  )
ORDER BY table_name, constraint_name;

-- Expected output:
-- confdeltype = 'c' means CASCADE
-- confdeltype = 'a' means NO ACTION (default)
-- confdeltype = 'r' means RESTRICT

-- =====================================================
-- STEP 4: Test cascade deletion (OPTIONAL - for testing only)
-- =====================================================

-- DO NOT RUN THIS IN PRODUCTION WITHOUT BACKUP!

/*
-- Test cascade deletion with a test developer
BEGIN;

-- Create test developer
INSERT INTO developers (id, name, email, phone, designation, added_by_admin)
VALUES (
  'test-developer-uuid-12345',
  'Test Developer',
  'test@example.com',
  '1234567890',
  'Junior Developer',
  (SELECT id FROM admin_users LIMIT 1)
);

-- Create test project for this developer
INSERT INTO projects (
  id,
  name,
  assigned_to,
  admin_id
) VALUES (
  'test-project-uuid-12345',
  'Test Project',
  'test-developer-uuid-12345',
  (SELECT id FROM admin_users LIMIT 1)
);

-- Create test task
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  start_date,
  end_date
) VALUES (
  'test-project-uuid-12345',
  'test-developer-uuid-12345',
  'Test Task',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '5 days'
);

-- Check records exist
SELECT COUNT(*) FROM projects WHERE assigned_to = 'test-developer-uuid-12345';
SELECT COUNT(*) FROM developer_tasks WHERE developer_id = 'test-developer-uuid-12345';

-- Delete developer (this should cascade)
DELETE FROM developers WHERE id = 'test-developer-uuid-12345';

-- Verify all related records were deleted
SELECT COUNT(*) FROM projects WHERE assigned_to = 'test-developer-uuid-12345'; -- Should be 0
SELECT COUNT(*) FROM developer_tasks WHERE developer_id = 'test-developer-uuid-12345'; -- Should be 0

ROLLBACK; -- Don't commit the test
*/

-- =====================================================
-- STEP 5: Check for any orphaned records (cleanup)
-- =====================================================

-- Find projects with non-existent developers
SELECT p.id, p.name, p.assigned_to
FROM projects p
LEFT JOIN developers d ON p.assigned_to = d.id
WHERE p.assigned_to IS NOT NULL
  AND d.id IS NULL;

-- Find tasks with non-existent developers
SELECT dt.id, dt.task_title, dt.developer_id
FROM developer_tasks dt
LEFT JOIN developers d ON dt.developer_id = d.id
WHERE d.id IS NULL;

-- Find tasks with non-existent projects
SELECT dt.id, dt.task_title, dt.project_id
FROM developer_tasks dt
LEFT JOIN projects p ON dt.project_id = p.id
WHERE p.id IS NULL;

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================

-- If you see this message, the migration was successful!
SELECT 'CASCADE deletion constraints successfully applied!' AS status;

-- Next steps:
-- 1. Test developer deletion in your application
-- 2. Verify that all related records are removed
-- 3. Check the admin dashboard updates correctly
