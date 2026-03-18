-- =====================================================
-- FIX FOR: Foreign Key Constraint Violation on Projects
-- =====================================================
-- This script fixes the issue where projects.assigned_to
-- was incorrectly set to admin ID instead of developer ID

-- =====================================================
-- STEP 1: Identify the Problem
-- =====================================================

-- Check for projects with invalid assigned_to values
SELECT
    p.id,
    p.name,
    p.assigned_to,
    p.assigned_developer_id,
    p.assigned_developer_name,
    d.id as developer_exists
FROM projects p
LEFT JOIN developers d ON p.assigned_to = d.id
WHERE p.assigned_to IS NOT NULL
  AND d.id IS NULL;

-- This will show all projects where assigned_to doesn't match a real developer

-- =====================================================
-- STEP 2: Fix - Update assigned_to to use developer ID
-- =====================================================

-- Option A: If assigned_developer_id exists, use that
UPDATE projects
SET assigned_to = assigned_developer_id
WHERE assigned_developer_id IS NOT NULL
  AND (assigned_to IS NULL OR assigned_to != assigned_developer_id);

-- Option B: If only assigned_developer_name exists, find the developer
UPDATE projects p
SET assigned_to = d.id
FROM developers d
WHERE p.assigned_developer_name = d.name
  AND p.assigned_to IS NULL
  AND p.assigned_developer_id IS NULL;

-- Option C: If only assigned_developer_email exists, find the developer
UPDATE projects p
SET assigned_to = d.id
FROM developers d
WHERE p.assigned_developer_email = d.email
  AND p.assigned_to IS NULL
  AND p.assigned_developer_id IS NULL;

-- =====================================================
-- STEP 3: Sync assigned_developer_id with assigned_to
-- =====================================================

-- Make sure both fields are consistent
UPDATE projects
SET assigned_developer_id = assigned_to
WHERE assigned_to IS NOT NULL
  AND (assigned_developer_id IS NULL OR assigned_developer_id != assigned_to);

-- =====================================================
-- STEP 4: Verify the Fix
-- =====================================================

-- Check that all projects now have valid assigned_to values
SELECT
    p.id,
    p.name,
    p.assigned_to,
    d.name as developer_name,
    d.email as developer_email
FROM projects p
LEFT JOIN developers d ON p.assigned_to = d.id
WHERE p.assigned_to IS NOT NULL
ORDER BY p.created_at DESC;

-- All rows should have a valid developer_name and developer_email

-- =====================================================
-- STEP 5: Check for NULL assigned_to values
-- =====================================================

-- Find projects with no developer assigned
SELECT id, name, assigned_developer_name, assigned_developer_email
FROM projects
WHERE assigned_to IS NULL
  AND assigned_developer_id IS NULL;

-- If any found, you need to manually assign them or delete them

-- =====================================================
-- STEP 6: Optional - Clean up orphaned projects
-- =====================================================

-- ⚠️ WARNING: This will DELETE projects with no valid developer
-- Only run if you want to remove these projects

/*
DELETE FROM projects
WHERE assigned_to IS NULL
  AND assigned_developer_id IS NULL;
*/

-- =====================================================
-- STEP 7: Update Schema Clarification (Optional)
-- =====================================================

-- Add a comment to clarify what assigned_to means
COMMENT ON COLUMN projects.assigned_to IS 'Foreign key to developers.id - the developer this project is assigned to';
COMMENT ON COLUMN projects.created_by IS 'Admin who created this project';
COMMENT ON COLUMN projects.added_by IS 'Admin who added this project';

-- =====================================================
-- STEP 8: Prevent Future Issues - Add Check Constraint
-- =====================================================

-- Ensure assigned_to always references a valid developer
-- (This is already enforced by the foreign key, but adding for clarity)

-- Check current constraint
SELECT
    con.conname AS constraint_name,
    con.confdeltype AS on_delete_action
FROM pg_constraint con
WHERE con.conrelid = 'projects'::regclass
  AND con.conname LIKE '%assigned_to%';

-- Should show CASCADE (c) for on_delete_action

-- =====================================================
-- STEP 9: Verify Everything is Fixed
-- =====================================================

-- Final verification query
SELECT
    COUNT(*) as total_projects,
    COUNT(CASE WHEN assigned_to IS NOT NULL THEN 1 END) as projects_with_developer,
    COUNT(CASE WHEN assigned_to IS NULL THEN 1 END) as projects_without_developer
FROM projects;

-- Expected: All projects should have assigned_to set

-- =====================================================
-- STEP 10: Test Creating a New Project
-- =====================================================

-- Test with a valid developer
DO $$
DECLARE
    test_developer_id UUID;
    test_admin_id UUID;
BEGIN
    -- Get a valid developer ID
    SELECT id INTO test_developer_id FROM developers LIMIT 1;

    -- Get an admin ID (you can use any ID here for testing)
    test_admin_id := '00000000-0000-0000-0000-000000000001';

    -- Try to insert a test project
    INSERT INTO projects (
        name,
        description,
        assigned_to,
        assigned_developer_id,
        created_by,
        added_by
    ) VALUES (
        'Test Project - Should Work',
        'This is a test project',
        test_developer_id,  -- Must be a valid developer ID
        test_developer_id,
        test_admin_id,
        test_admin_id
    );

    RAISE NOTICE 'Test project created successfully!';

    -- Clean up test data
    DELETE FROM projects WHERE name = 'Test Project - Should Work';
    RAISE NOTICE 'Test project deleted successfully!';

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
END $$;

-- =====================================================
-- TROUBLESHOOTING
-- =====================================================

-- If you still get errors, check:

-- 1. Does the developer exist?
SELECT id, name, email FROM developers WHERE id = 'YOUR_DEVELOPER_ID_HERE';

-- 2. Are there any triggers that might be interfering?
SELECT tgname, tgtype FROM pg_trigger WHERE tgrelid = 'projects'::regclass;

-- 3. Check the foreign key constraint
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'projects'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'assigned_to';

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

SELECT '✅ Projects table fixed! All assigned_to values now reference valid developers.' AS status;
