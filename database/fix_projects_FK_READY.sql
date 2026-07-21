-- =====================================================
-- FIX PROJECTS FOREIGN KEY - READY TO RUN VERSION
-- No placeholders - safe to execute directly
-- =====================================================

-- =====================================================
-- STEP 1: Identify Problem Projects
-- =====================================================

-- Check for projects with invalid assigned_to values
SELECT
    p.id,
    p.name,
    p.assigned_to as current_assigned_to,
    p.assigned_developer_id,
    p.assigned_developer_name,
    d.id as developer_exists
FROM projects p
LEFT JOIN developers d ON p.assigned_to = d.id
WHERE p.assigned_to IS NOT NULL
  AND d.id IS NULL;

-- ✅ If this returns 0 rows, no fix needed!
-- ⚠️ If this returns rows, continue with the fix below

-- =====================================================
-- STEP 2: Fix Projects - Auto Update
-- =====================================================

-- Fix Option A: Use assigned_developer_id if it exists
UPDATE projects
SET assigned_to = assigned_developer_id,
    updated_at = NOW()
WHERE assigned_developer_id IS NOT NULL
  AND assigned_developer_id IN (SELECT id FROM developers)
  AND (assigned_to IS NULL OR assigned_to != assigned_developer_id);

-- Check how many were updated
SELECT COUNT(*) as fixed_count_option_a FROM projects
WHERE assigned_to = assigned_developer_id
  AND updated_at > NOW() - INTERVAL '1 minute';

-- Fix Option B: Find developer by name
UPDATE projects p
SET assigned_to = d.id,
    assigned_developer_id = d.id,
    updated_at = NOW()
FROM developers d
WHERE p.assigned_developer_name = d.name
  AND p.assigned_to != d.id
  OR (p.assigned_to IS NULL AND p.assigned_developer_name IS NOT NULL);

-- Fix Option C: Find developer by email
UPDATE projects p
SET assigned_to = d.id,
    assigned_developer_id = d.id,
    updated_at = NOW()
FROM developers d
WHERE p.assigned_developer_email = d.email
  AND (p.assigned_to IS NULL OR p.assigned_to != d.id);

-- =====================================================
-- STEP 3: Verify the Fix
-- =====================================================

-- Check that all projects now have valid assigned_to
SELECT
    COUNT(*) as total_projects,
    COUNT(CASE WHEN assigned_to IS NOT NULL THEN 1 END) as with_developer,
    COUNT(CASE WHEN assigned_to IS NULL THEN 1 END) as without_developer
FROM projects;

-- Check for remaining broken projects
SELECT
    p.id,
    p.name,
    p.assigned_to,
    p.assigned_developer_name
FROM projects p
LEFT JOIN developers d ON p.assigned_to = d.id
WHERE p.assigned_to IS NOT NULL
  AND d.id IS NULL;

-- ✅ Should return 0 rows now!

-- =====================================================
-- STEP 4: Sync All Related Fields
-- =====================================================

-- Make sure assigned_developer_id matches assigned_to
UPDATE projects
SET assigned_developer_id = assigned_to
WHERE assigned_to IS NOT NULL
  AND (assigned_developer_id IS NULL OR assigned_developer_id != assigned_to);

-- Update developer name and email from actual developer record
UPDATE projects p
SET
    assigned_developer_name = d.name,
    assigned_developer_email = d.email,
    updated_at = NOW()
FROM developers d
WHERE p.assigned_to = d.id
  AND (p.assigned_developer_name != d.name OR p.assigned_developer_email != d.email);

-- =====================================================
-- STEP 5: Handle Projects with No Developer
-- =====================================================

-- Find projects that have no developer assigned at all
SELECT id, name, created_at
FROM projects
WHERE assigned_to IS NULL
  AND assigned_developer_id IS NULL
  AND assigned_developer_name IS NULL;

-- ⚠️ If you want to assign these to a default developer:
-- (Uncomment and modify the following)

/*
-- Get the first available developer
DO $$
DECLARE
    default_dev_id UUID;
BEGIN
    -- Get first active developer
    SELECT id INTO default_dev_id
    FROM developers
    WHERE status = 'active'
    LIMIT 1;

    IF default_dev_id IS NOT NULL THEN
        -- Assign orphaned projects to this developer
        UPDATE projects
        SET assigned_to = default_dev_id,
            assigned_developer_id = default_dev_id
        WHERE assigned_to IS NULL
          AND assigned_developer_id IS NULL;

        RAISE NOTICE 'Assigned % orphaned projects to developer %',
            (SELECT COUNT(*) FROM projects WHERE assigned_to = default_dev_id),
            default_dev_id;
    ELSE
        RAISE NOTICE 'No active developers found. Cannot assign orphaned projects.';
    END IF;
END $$;
*/

-- =====================================================
-- STEP 6: Final Verification
-- =====================================================

-- Comprehensive check
SELECT
    'Total Projects' as metric,
    COUNT(*)::TEXT as value
FROM projects
UNION ALL
SELECT
    'Projects with Valid Developer',
    COUNT(*)::TEXT
FROM projects p
INNER JOIN developers d ON p.assigned_to = d.id
UNION ALL
SELECT
    'Projects with Invalid Developer',
    COUNT(*)::TEXT
FROM projects p
LEFT JOIN developers d ON p.assigned_to = d.id
WHERE p.assigned_to IS NOT NULL AND d.id IS NULL
UNION ALL
SELECT
    'Projects with No Developer',
    COUNT(*)::TEXT
FROM projects
WHERE assigned_to IS NULL;

-- =====================================================
-- STEP 7: Show Updated Projects
-- =====================================================

-- Display all projects with their assigned developers
SELECT
    p.id,
    p.name as project_name,
    d.name as developer_name,
    d.email as developer_email,
    d.status as developer_status,
    p.created_at,
    p.updated_at
FROM projects p
LEFT JOIN developers d ON p.assigned_to = d.id
ORDER BY p.created_at DESC
LIMIT 20;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
DECLARE
    broken_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO broken_count
    FROM projects p
    LEFT JOIN developers d ON p.assigned_to = d.id
    WHERE p.assigned_to IS NOT NULL AND d.id IS NULL;

    IF broken_count = 0 THEN
        RAISE NOTICE '✅ SUCCESS! All projects have valid developer assignments.';
    ELSE
        RAISE NOTICE '⚠️ WARNING: Still have % projects with invalid developers.', broken_count;
    END IF;
END $$;

-- =====================================================
-- ADDITIONAL CHECKS (Optional)
-- =====================================================

-- Check foreign key constraint status
SELECT
    conname as constraint_name,
    confdeltype as on_delete_action,
    CASE confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
    END as delete_rule_description
FROM pg_constraint
WHERE conrelid = 'projects'::regclass
  AND conname LIKE '%assigned_to%';

-- List all developers for reference
SELECT
    id,
    name,
    email,
    status,
    created_at
FROM developers
ORDER BY name;

-- =====================================================
-- CLEANUP SECTION (Only if needed)
-- =====================================================

-- ⚠️ WARNING: The following will DELETE data!
-- Only uncomment if you want to remove orphaned projects

/*
-- Delete projects that cannot be fixed (no developer info at all)
DELETE FROM projects
WHERE assigned_to IS NULL
  AND assigned_developer_id IS NULL
  AND assigned_developer_name IS NULL
  AND assigned_developer_email IS NULL;

-- Check what was deleted
SELECT 'Deleted orphaned projects without any developer info' as status;
*/

-- =====================================================
-- END OF SCRIPT
-- =====================================================
