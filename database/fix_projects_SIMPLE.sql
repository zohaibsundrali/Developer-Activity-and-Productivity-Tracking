-- =====================================================
-- SIMPLE FIX - Just Fix the Projects (3 Steps)
-- =====================================================

-- STEP 1: Fix projects using assigned_developer_id
UPDATE projects
SET assigned_to = assigned_developer_id
WHERE assigned_developer_id IS NOT NULL
  AND assigned_developer_id IN (SELECT id FROM developers);

-- STEP 2: Fix projects using developer name
UPDATE projects p
SET assigned_to = d.id,
    assigned_developer_id = d.id
FROM developers d
WHERE p.assigned_developer_name = d.name
  AND (p.assigned_to IS NULL OR p.assigned_to != d.id);

-- STEP 3: Fix projects using developer email
UPDATE projects p
SET assigned_to = d.id,
    assigned_developer_id = d.id
FROM developers d
WHERE p.assigned_developer_email = d.email
  AND (p.assigned_to IS NULL OR p.assigned_to != d.id);

-- ✅ DONE! Check results:
SELECT
    p.name as project,
    d.name as developer,
    d.email
FROM projects p
JOIN developers d ON p.assigned_to = d.id
ORDER BY p.created_at DESC;
