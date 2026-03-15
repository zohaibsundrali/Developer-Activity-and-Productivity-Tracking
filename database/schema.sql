-- =====================================================
-- DEVELOPER PRODUCTIVITY TRACKING SYSTEM
-- Database Schema for Supabase
-- =====================================================

-- ==================== DEVELOPERS TABLE ====================
-- (Already exists in your system)
CREATE TABLE IF NOT EXISTS developers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  designation TEXT DEFAULT 'Developer',
  department TEXT,
  added_by_admin UUID,
  admin_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  profile_image TEXT
);

-- ==================== ALTER EXISTING TABLES ====================
-- Add new columns to pre-existing tables (safe to run multiple times)

-- Projects table additions
ALTER TABLE projects ADD COLUMN IF NOT EXISTS total_productivity_score DECIMAL(5,2) DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS total_tasks_count INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_tasks_count INTEGER DEFAULT 0;

-- Developer tasks additions (in case table already existed with fewer columns)
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS task_order INTEGER DEFAULT 0;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS task_description TEXT;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS actual_completion_date DATE;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS is_on_time BOOLEAN;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS productivity_points INTEGER DEFAULT 0;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS admin_comments TEXT;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE developer_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update status CHECK constraint to include all workflow values
ALTER TABLE developer_tasks DROP CONSTRAINT IF EXISTS developer_tasks_status_check;
ALTER TABLE developer_tasks ADD CONSTRAINT developer_tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'awaiting_approval', 'completed', 'rejected'));

-- Task submissions additions (in case table already existed)
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS submission_notes TEXT;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS review_comments TEXT;

-- ==================== PROJECTS TABLE ====================
-- (Already exists in your system - enhanced)
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'on_hold', 'cancelled')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  deadline TIMESTAMP WITH TIME ZONE,
  file_url TEXT,
  file_name TEXT,
  assigned_to UUID REFERENCES developers(id),
  assigned_to_email TEXT,
  assigned_developer_name TEXT,
  assigned_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  admin_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- New productivity fields
  total_productivity_score DECIMAL(5,2) DEFAULT 0,
  total_tasks_count INTEGER DEFAULT 0,
  completed_tasks_count INTEGER DEFAULT 0
);

-- ==================== DEVELOPER_TASKS TABLE ====================
-- (Enhanced - this replaces your existing table)
CREATE TABLE IF NOT EXISTS developer_tasks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  developer_id UUID REFERENCES developers(id) ON DELETE CASCADE,
  
  -- Task Details
  task_title TEXT NOT NULL,
  task_description TEXT,
  task_order INTEGER DEFAULT 0,
  
  -- Timeline
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  actual_completion_date DATE,
  
  -- Status Flow: pending -> in_progress -> awaiting_approval -> completed/rejected
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',           -- Not started
    'in_progress',       -- Developer working on it
    'awaiting_approval', -- Developer submitted, waiting for admin review
    'completed',         -- Admin approved
    'rejected'           -- Admin rejected
  )),
  
  -- Productivity Tracking
  is_on_time BOOLEAN,                    -- Completed within deadline?
  productivity_points INTEGER DEFAULT 0,  -- +1 for on-time, -1 for late
  
  -- Admin Review
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  admin_comments TEXT,
  rejection_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  submitted_at TIMESTAMP WITH TIME ZONE
);

-- ==================== TASK_SUBMISSIONS TABLE ====================
-- Stores proof of work uploads for each task
CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  task_id UUID REFERENCES developer_tasks(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  developer_id UUID REFERENCES developers(id) ON DELETE CASCADE,
  
  -- File Information
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,                -- pdf, docx, doc, etc.
  file_size INTEGER,             -- in bytes
  storage_path TEXT,             -- Supabase storage path
  
  -- Submission Details
  submission_notes TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Review Status
  is_reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  review_comments TEXT
);

-- ==================== PRODUCTIVITY_METRICS TABLE ====================
-- Stores aggregated productivity data for developers
CREATE TABLE IF NOT EXISTS productivity_metrics (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  developer_id UUID REFERENCES developers(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Task Counts
  total_tasks INTEGER DEFAULT 0,
  completed_on_time INTEGER DEFAULT 0,
  completed_late INTEGER DEFAULT 0,
  pending_tasks INTEGER DEFAULT 0,
  rejected_tasks INTEGER DEFAULT 0,
  
  -- Productivity Scores
  productivity_percentage DECIMAL(5,2) DEFAULT 0,  -- 0-100%
  productivity_points INTEGER DEFAULT 0,            -- Sum of +1/-1
  
  -- Time Metrics
  average_completion_time INTEGER,  -- in days
  total_days_worked INTEGER DEFAULT 0,
  
  -- Timestamps
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint: one record per developer per project
  UNIQUE(developer_id, project_id)
);

-- ==================== ACTIVITY_LOGS TABLE ====================
-- Tracks all task-related activities for admin review
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  developer_id UUID REFERENCES developers(id),
  project_id UUID REFERENCES projects(id),
  task_id UUID REFERENCES developer_tasks(id),
  
  -- Activity Details
  action_type TEXT NOT NULL CHECK (action_type IN (
    'task_created',
    'task_updated',
    'task_started',
    'task_submitted',
    'task_approved',
    'task_rejected',
    'file_uploaded',
    'deadline_changed',
    'status_changed'
  )),
  action_description TEXT,
  old_value TEXT,
  new_value TEXT,
  
  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== ADMIN_REVIEWS TABLE ====================
-- Stores admin review history
CREATE TABLE IF NOT EXISTS admin_reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  admin_id UUID NOT NULL,
  admin_email TEXT,
  admin_name TEXT,
  
  -- Review Target
  task_id UUID REFERENCES developer_tasks(id),
  submission_id UUID REFERENCES task_submissions(id),
  project_id UUID REFERENCES projects(id),
  developer_id UUID REFERENCES developers(id),
  
  -- Review Details
  review_action TEXT NOT NULL CHECK (review_action IN ('approved', 'rejected')),
  review_comments TEXT,
  rejection_reason TEXT,
  
  -- Related Data (cached for history)
  task_title TEXT,
  developer_name TEXT,
  project_name TEXT,
  submission_file_url TEXT,
  deadline DATE,
  submission_date TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== NOTIFICATIONS TABLE ====================
-- (Enhanced version of your existing table)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  
  -- Recipients
  admin_id UUID,
  admin_email TEXT,
  developer_id UUID REFERENCES developers(id),
  assigned_developer_id UUID,
  
  -- Notification Content
  type TEXT NOT NULL CHECK (type IN (
    'task_submitted',
    'task_approved',
    'task_rejected',
    'project_assigned',
    'deadline_reminder',
    'productivity_alert',
    'file_uploaded',
    'review_required'
  )),
  message TEXT NOT NULL,
  title TEXT,
  
  -- Related Entities
  project_id UUID,
  task_id UUID,
  submission_id UUID,
  
  -- Status
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== INDEXES ====================
-- Performance optimization indexes

CREATE INDEX IF NOT EXISTS idx_developer_tasks_project ON developer_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_developer_tasks_developer ON developer_tasks(developer_id);
CREATE INDEX IF NOT EXISTS idx_developer_tasks_status ON developer_tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_submissions_task ON task_submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_developer ON task_submissions(developer_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_developer ON activity_logs(developer_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_project ON activity_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_admin ON notifications(admin_id);
CREATE INDEX IF NOT EXISTS idx_notifications_developer ON notifications(developer_id);
CREATE INDEX IF NOT EXISTS idx_productivity_metrics_developer ON productivity_metrics(developer_id);

-- ==================== FUNCTIONS ====================

-- Function to calculate productivity for a developer on a project
CREATE OR REPLACE FUNCTION calculate_project_productivity(p_developer_id UUID, p_project_id UUID)
RETURNS TABLE (
  total_tasks INTEGER,
  completed_on_time INTEGER,
  completed_late INTEGER,
  productivity_percentage DECIMAL(5,2),
  productivity_points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_tasks,
    COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = true)::INTEGER as completed_on_time,
    COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = false)::INTEGER as completed_late,
    CASE 
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
        (COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = true)::DECIMAL / COUNT(*)::DECIMAL) * 100,
        2
      )
    END as productivity_percentage,
    (COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = true) - 
     COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = false))::INTEGER as productivity_points
  FROM developer_tasks
  WHERE developer_id = p_developer_id AND project_id = p_project_id;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate overall developer productivity
CREATE OR REPLACE FUNCTION calculate_overall_productivity(p_developer_id UUID)
RETURNS TABLE (
  total_projects INTEGER,
  total_tasks INTEGER,
  completed_on_time INTEGER,
  completed_late INTEGER,
  pending_tasks INTEGER,
  productivity_percentage DECIMAL(5,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT project_id)::INTEGER as total_projects,
    COUNT(*)::INTEGER as total_tasks,
    COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = true)::INTEGER as completed_on_time,
    COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = false)::INTEGER as completed_late,
    COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress', 'awaiting_approval'))::INTEGER as pending_tasks,
    CASE 
      WHEN COUNT(*) FILTER (WHERE status = 'completed') = 0 THEN 0
      ELSE ROUND(
        (COUNT(*) FILTER (WHERE status = 'completed' AND is_on_time = true)::DECIMAL / 
         COUNT(*) FILTER (WHERE status = 'completed')::DECIMAL) * 100,
        2
      )
    END as productivity_percentage
  FROM developer_tasks
  WHERE developer_id = p_developer_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update project progress when task status changes
CREATE OR REPLACE FUNCTION update_project_progress()
RETURNS TRIGGER AS $$
DECLARE
  total_count INTEGER;
  completed_count INTEGER;
  new_progress INTEGER;
BEGIN
  -- Get task counts for the project
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO total_count, completed_count
  FROM developer_tasks
  WHERE project_id = NEW.project_id;
  
  -- Calculate progress percentage
  IF total_count > 0 THEN
    new_progress := ROUND((completed_count::DECIMAL / total_count::DECIMAL) * 100);
  ELSE
    new_progress := 0;
  END IF;
  
  -- Update project
  UPDATE projects
  SET 
    progress = new_progress,
    completed_tasks_count = completed_count,
    total_tasks_count = total_count,
    status = CASE 
      WHEN new_progress = 100 THEN 'completed'
      WHEN new_progress > 0 THEN 'in_progress'
      ELSE 'pending'
    END,
    updated_at = NOW()
  WHERE id = NEW.project_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for project progress update
DROP TRIGGER IF EXISTS trigger_update_project_progress ON developer_tasks;
CREATE TRIGGER trigger_update_project_progress
  AFTER INSERT OR UPDATE OF status ON developer_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_project_progress();

-- ==================== ROW LEVEL SECURITY ====================

-- Enable RLS on tables
ALTER TABLE developer_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE productivity_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_reviews ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Note: This app uses localStorage-based auth (not Supabase Auth),
-- so auth.uid() is not applicable. Access control is handled at
-- the application layer. Policies below allow full access.

DROP POLICY IF EXISTS "Allow all access to developer_tasks" ON developer_tasks;
CREATE POLICY "Allow all access to developer_tasks"
  ON developer_tasks
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to task_submissions" ON task_submissions;
CREATE POLICY "Allow all access to task_submissions"
  ON task_submissions
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to productivity_metrics" ON productivity_metrics;
CREATE POLICY "Allow all access to productivity_metrics"
  ON productivity_metrics
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to activity_logs" ON activity_logs;
CREATE POLICY "Allow all access to activity_logs"
  ON activity_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to admin_reviews" ON admin_reviews;
CREATE POLICY "Allow all access to admin_reviews"
  ON admin_reviews
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ==================== STORAGE BUCKETS ====================
-- Run these in Supabase Dashboard > Storage

-- Create bucket for task submissions
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('task-submissions', 'task-submissions', true);

-- Storage policy for task submissions
-- CREATE POLICY "Developers can upload submissions"
-- ON storage.objects FOR INSERT
-- WITH CHECK (bucket_id = 'task-submissions');

-- CREATE POLICY "Anyone can view submissions"
-- ON storage.objects FOR SELECT
-- USING (bucket_id = 'task-submissions');
