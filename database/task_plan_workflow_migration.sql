-- Migration: Project task plan workflow fields
-- Date: 2026-04-21
-- Purpose: Add a DB-backed task plan submission flag + status fields

ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_plan_submitted BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_plan_status TEXT DEFAULT 'draft';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_plan_submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_plan_reviewed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_plan_reviewed_by UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_plan_rejection_reason TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_task_template JSONB;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_task_plan_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_task_plan_status_check
  CHECK (task_plan_status IN ('draft', 'pending', 'approved', 'rejected'));

-- Backfill: if a project already has task_plan_status/submitted_at set, ensure task_plan_submitted is true
UPDATE projects
SET task_plan_submitted = true
WHERE task_plan_submitted IS DISTINCT FROM true
  AND (
    task_plan_submitted_at IS NOT NULL OR
    task_plan_status IN ('pending', 'approved', 'rejected')
  );

-- Backfill: normalize NULL/empty statuses to 'draft'
UPDATE projects
SET task_plan_status = 'draft'
WHERE task_plan_status IS NULL OR task_plan_status = '';
