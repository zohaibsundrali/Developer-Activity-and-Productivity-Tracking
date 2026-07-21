-- Migration: Add 'reviewed' status to developer_tasks table
-- Date: 2026-03-25
-- Description: Extends the valid_status constraint to include 'reviewed' status
-- This allows tasks to be marked as reviewed before final completion

-- Drop the existing check constraint
ALTER TABLE developer_tasks DROP CONSTRAINT IF EXISTS developer_tasks_status_check;

-- Add the updated constraint with 'reviewed' included
ALTER TABLE developer_tasks ADD CONSTRAINT developer_tasks_status_check
  CHECK (status IN (
    'pending',           -- Not started
    'in_progress',       -- Developer working on it
    'awaiting_approval', -- Developer submitted, waiting for admin review
    'reviewed',          -- Admin has reviewed (optional intermediate state)
    'completed',         -- Admin approved
    'rejected'           -- Admin rejected
  ));

-- Add comment to explain the status workflow
COMMENT ON COLUMN developer_tasks.status IS
  'Status flow: pending → in_progress → awaiting_approval → [reviewed] → completed/rejected';
