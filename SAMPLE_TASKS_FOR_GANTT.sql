-- =====================================================
-- SAMPLE TASKS FOR GANTT CHART TESTING
-- Execute these SQL statements in Supabase SQL Editor
-- =====================================================

-- Prerequisites:
-- 1. You must have a project created
-- 2. You must have a developer added
-- 3. Replace the UUIDs below with your actual IDs

-- =====================================================
-- STEP 1: Find your Project ID and Developer ID
-- =====================================================

-- Find your project ID
SELECT id, name FROM projects ORDER BY created_at DESC LIMIT 5;

-- Find your developer ID
SELECT id, name, email FROM developers ORDER BY created_at DESC LIMIT 5;

-- =====================================================
-- STEP 2: Create Sample Tasks
-- Replace 'YOUR_PROJECT_ID' and 'YOUR_DEVELOPER_ID' below
-- =====================================================

-- Task 1: Design Phase (Pending)
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status
) VALUES (
  'YOUR_PROJECT_ID',  -- Replace this
  'YOUR_DEVELOPER_ID', -- Replace this
  'Design System Setup',
  'Create design tokens, color palette, and typography system',
  1,
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '5 days',
  'pending'
);

-- Task 2: Frontend Development (In Progress)
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status
) VALUES (
  'YOUR_PROJECT_ID',
  'YOUR_DEVELOPER_ID',
  'Login Page UI',
  'Build responsive login page with form validation',
  2,
  CURRENT_DATE + INTERVAL '1 day',
  CURRENT_DATE + INTERVAL '7 days',
  'in_progress'
);

-- Task 3: Backend API (Awaiting Approval)
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status,
  submitted_at
) VALUES (
  'YOUR_PROJECT_ID',
  'YOUR_DEVELOPER_ID',
  'Authentication API',
  'Implement JWT-based authentication endpoints',
  3,
  CURRENT_DATE - INTERVAL '3 days',
  CURRENT_DATE + INTERVAL '2 days',
  'awaiting_approval',
  CURRENT_DATE - INTERVAL '1 hour'
);

-- Task 4: Database Setup (Completed On-Time)
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status,
  actual_completion_date,
  is_on_time,
  productivity_points,
  submitted_at,
  reviewed_at,
  admin_comments
) VALUES (
  'YOUR_PROJECT_ID',
  'YOUR_DEVELOPER_ID',
  'Database Schema Design',
  'Design and implement database tables and relationships',
  4,
  CURRENT_DATE - INTERVAL '10 days',
  CURRENT_DATE - INTERVAL '5 days',
  'completed',
  CURRENT_DATE - INTERVAL '6 days',
  true,
  1,
  CURRENT_DATE - INTERVAL '6 days',
  CURRENT_DATE - INTERVAL '5 days',
  'Great work! Schema is well-structured.'
);

-- Task 5: Testing (Completed Late)
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status,
  actual_completion_date,
  is_on_time,
  productivity_points,
  submitted_at,
  reviewed_at,
  admin_comments
) VALUES (
  'YOUR_PROJECT_ID',
  'YOUR_DEVELOPER_ID',
  'Unit Testing',
  'Write unit tests for authentication module',
  5,
  CURRENT_DATE - INTERVAL '15 days',
  CURRENT_DATE - INTERVAL '10 days',
  'completed',
  CURRENT_DATE - INTERVAL '8 days',
  false,
  -1,
  CURRENT_DATE - INTERVAL '8 days',
  CURRENT_DATE - INTERVAL '7 days',
  'Good tests, but submitted late. Please improve time management.'
);

-- Task 6: Code Review (Rejected)
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status,
  submitted_at,
  reviewed_at,
  rejection_reason,
  admin_comments
) VALUES (
  'YOUR_PROJECT_ID',
  'YOUR_DEVELOPER_ID',
  'Code Optimization',
  'Refactor code for better performance',
  6,
  CURRENT_DATE - INTERVAL '5 days',
  CURRENT_DATE - INTERVAL '1 day',
  'rejected',
  CURRENT_DATE - INTERVAL '2 days',
  CURRENT_DATE - INTERVAL '1 day',
  'Code does not follow best practices.',
  'Please review the coding standards document and resubmit.'
);

-- Task 7: Documentation (Future Task)
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status
) VALUES (
  'YOUR_PROJECT_ID',
  'YOUR_DEVELOPER_ID',
  'API Documentation',
  'Write comprehensive API documentation with examples',
  7,
  CURRENT_DATE + INTERVAL '5 days',
  CURRENT_DATE + INTERVAL '10 days',
  'pending'
);

-- Task 8: Deployment Preparation
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  task_order,
  start_date,
  end_date,
  status
) VALUES (
  'YOUR_PROJECT_ID',
  'YOUR_DEVELOPER_ID',
  'Deployment Configuration',
  'Set up CI/CD pipeline and production environment',
  8,
  CURRENT_DATE + INTERVAL '8 days',
  CURRENT_DATE + INTERVAL '15 days',
  'pending'
);

-- =====================================================
-- STEP 3: Verify Tasks Created
-- =====================================================

SELECT
  task_title,
  start_date,
  end_date,
  status,
  is_on_time,
  productivity_points
FROM developer_tasks
WHERE project_id = 'YOUR_PROJECT_ID'
ORDER BY task_order;

-- =====================================================
-- STEP 4: Check Project Progress
-- =====================================================

-- This should show updated progress based on completed tasks
SELECT
  name,
  progress,
  status,
  total_tasks_count,
  completed_tasks_count
FROM projects
WHERE id = 'YOUR_PROJECT_ID';

-- =====================================================
-- BONUS: Create Tasks with Multiple Developers
-- =====================================================

-- If you have multiple developers, you can assign different tasks:

-- Get list of developers
SELECT id, name FROM developers LIMIT 5;

-- Create task for Developer 1
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  start_date,
  end_date,
  status,
  task_order
) VALUES (
  'YOUR_PROJECT_ID',
  'DEVELOPER_1_ID',  -- Replace with first developer ID
  'Frontend Components',
  'Build reusable React components',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '7 days',
  'in_progress',
  9
);

-- Create task for Developer 2
INSERT INTO developer_tasks (
  project_id,
  developer_id,
  task_title,
  task_description,
  start_date,
  end_date,
  status,
  task_order
) VALUES (
  'YOUR_PROJECT_ID',
  'DEVELOPER_2_ID',  -- Replace with second developer ID
  'Backend Services',
  'Implement REST API services',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '7 days',
  'in_progress',
  10
);

-- =====================================================
-- ALTERNATIVE: JavaScript/TypeScript Code to Create Tasks
-- =====================================================

/*
// In your Next.js application or API route:

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function createSampleTasks(projectId, developerId) {
  const today = new Date();

  const tasks = [
    {
      project_id: projectId,
      developer_id: developerId,
      task_title: 'Design System Setup',
      task_description: 'Create design tokens and color palette',
      task_order: 1,
      start_date: today.toISOString().split('T')[0],
      end_date: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'pending'
    },
    {
      project_id: projectId,
      developer_id: developerId,
      task_title: 'Login Page UI',
      task_description: 'Build responsive login page',
      task_order: 2,
      start_date: new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'in_progress'
    },
    {
      project_id: projectId,
      developer_id: developerId,
      task_title: 'Authentication API',
      task_description: 'Implement JWT authentication',
      task_order: 3,
      start_date: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'awaiting_approval',
      submitted_at: new Date().toISOString()
    },
    {
      project_id: projectId,
      developer_id: developerId,
      task_title: 'Database Schema',
      task_description: 'Design database tables',
      task_order: 4,
      start_date: new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'completed',
      actual_completion_date: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      is_on_time: true,
      productivity_points: 1,
      submitted_at: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      reviewed_at: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      admin_comments: 'Great work!'
    },
    {
      project_id: projectId,
      developer_id: developerId,
      task_title: 'Unit Testing',
      task_description: 'Write unit tests',
      task_order: 5,
      start_date: new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'completed',
      actual_completion_date: new Date(today.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      is_on_time: false,
      productivity_points: -1,
      submitted_at: new Date(today.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      reviewed_at: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      admin_comments: 'Good tests but submitted late'
    }
  ];

  const { data, error } = await supabase
    .from('developer_tasks')
    .insert(tasks)
    .select();

  if (error) {
    console.error('Error creating tasks:', error);
    return null;
  }

  console.log('Tasks created successfully:', data);
  return data;
}

// Usage:
// createSampleTasks('project-uuid-here', 'developer-uuid-here');
*/

-- =====================================================
-- USEFUL QUERIES
-- =====================================================

-- Count tasks by status
SELECT
  status,
  COUNT(*) as count
FROM developer_tasks
WHERE project_id = 'YOUR_PROJECT_ID'
GROUP BY status;

-- Calculate productivity metrics
SELECT
  COUNT(*) FILTER (WHERE is_on_time = true) as on_time_count,
  COUNT(*) FILTER (WHERE is_on_time = false) as late_count,
  SUM(productivity_points) as total_points
FROM developer_tasks
WHERE project_id = 'YOUR_PROJECT_ID'
  AND status = 'completed';

-- Get tasks grouped by developer
SELECT
  d.name as developer_name,
  COUNT(*) as total_tasks,
  COUNT(*) FILTER (WHERE dt.status = 'completed') as completed_tasks,
  COUNT(*) FILTER (WHERE dt.is_on_time = true) as on_time_tasks
FROM developer_tasks dt
JOIN developers d ON dt.developer_id = d.id
WHERE dt.project_id = 'YOUR_PROJECT_ID'
GROUP BY d.name;

-- Find overdue tasks
SELECT
  task_title,
  end_date,
  status,
  d.name as developer_name
FROM developer_tasks dt
JOIN developers d ON dt.developer_id = d.id
WHERE dt.project_id = 'YOUR_PROJECT_ID'
  AND dt.end_date < CURRENT_DATE
  AND dt.status NOT IN ('completed', 'rejected');

-- =====================================================
-- CLEANUP (if needed)
-- =====================================================

-- Delete all tasks for a project (use with caution!)
-- DELETE FROM developer_tasks WHERE project_id = 'YOUR_PROJECT_ID';

-- Reset task statuses (for testing)
-- UPDATE developer_tasks
-- SET status = 'pending', submitted_at = NULL, reviewed_at = NULL
-- WHERE project_id = 'YOUR_PROJECT_ID';
