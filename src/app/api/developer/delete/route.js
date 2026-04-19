import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');

async function resolveDeveloper({ developerId, developerEmail, userId }) {
  const normalizedId = normalize(developerId);
  const normalizedEmail = normalize(developerEmail).toLowerCase();
  const normalizedUserId = normalize(userId);

  if (normalizedId) {
    const { data, error } = await supabase
      .from('developers')
      .select('id, name, email, added_by, added_by_admin, added_by_name')
      .eq('id', normalizedId)
      .maybeSingle();

    if (!error && data) return data;

    // Fallback: some callers pass user_id as developerId (legacy schemas only)
    // Current schema does not include user_id, so skip this lookup when blank.
  }

  // userId lookup intentionally omitted for schemas without user_id.
  // Keep the parameter for compatibility with callers.

  if (normalizedEmail) {
    const { data, error } = await supabase
      .from('developers')
      .select('id, name, email, added_by, added_by_admin, added_by_name')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (!error && data) return data;
  }

  return null;
}

function isAdminAuthorizedForDeveloper(developer, adminId, adminEmail) {
  const normalizedAdminId = normalize(adminId);
  const normalizedAdminEmail = normalize(adminEmail).toLowerCase();

  const addedBy = normalize(developer?.added_by);
  const addedByAdmin = normalize(developer?.added_by_admin).toLowerCase();

  return Boolean(
    (normalizedAdminId && addedBy === normalizedAdminId) ||
    (normalizedAdminEmail && addedByAdmin === normalizedAdminEmail)
  );
}

async function getProjectIdsForDeveloper(developerId) {
  const projectIdSet = new Set();

  const { data: projectsByAssignedTo } = await supabase
    .from('projects')
    .select('id')
    .eq('assigned_to', developerId);

  (projectsByAssignedTo || []).forEach((p) => projectIdSet.add(p.id));

  const { data: projectsByAssignedDev } = await supabase
    .from('projects')
    .select('id')
    .eq('assigned_developer_id', developerId);

  (projectsByAssignedDev || []).forEach((p) => projectIdSet.add(p.id));

  return Array.from(projectIdSet);
}

async function safeDelete(table, queryBuilder) {
  const { error } = await queryBuilder;
  if (error) {
    // Ignore cleanup for optional tables/columns that may not exist in older schemas.
    if (error.code === '42P01' || error.code === '42703') {
      return;
    }
    throw new Error(`${table}: ${error.message}`);
  }
}

// ─── DELETE /api/developer/delete ─────────────────────────────────────────────
/**
 * Safely delete one specific developer and all their associated data.
 *
 * Body (JSON):
 *   developerId    {string}  UUID primary key of the developer  ← strongly preferred
 *   developerEmail {string}  Fallback – only used when developerId is absent
 *   userId         {string}  Fallback – only used when developerId is absent
 *   adminId        {string}  UUID of the requesting admin
 *   adminEmail     {string}  Email of the requesting admin
 */
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { developerId, developerEmail, userId, adminId, adminEmail } = body;

    // ── 1. Input validation ──────────────────────────────────────────────────
    if (!developerId && !developerEmail && !userId) {
      return NextResponse.json(
        { success: false, error: 'A developer identifier (id, email, or userId) is required.' },
        { status: 400 }
      );
    }
    if (!adminId || !adminEmail) {
      return NextResponse.json(
        { success: false, error: 'Admin credentials (adminId and adminEmail) are required.' },
        { status: 401 }
      );
    }

    // ── 2. Resolve developer – strict UUID-first, no silent fallback ─────────
    let developer;
    try {
      developer = await resolveDeveloper({ developerId, developerEmail, userId });
    } catch (resolveError) {
      return NextResponse.json(
        { success: false, error: resolveError.message },
        { status: 500 }
      );
    }

    if (!developer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Developer not found.',
          detail: {
            developerId:    developerId    || null,
            developerEmail: developerEmail || null,
            userId:         userId         || null,
          },
        },
        { status: 404 }
      );
    }

    // Use the resolved primary key for ALL subsequent queries.
    // This is the single source of truth – prevents ANY cross-developer pollution.
    const devId = developer.id;

    // ── 3. Authorization ─────────────────────────────────────────────────────
    if (!isAdminAuthorizedForDeveloper(developer, adminId, adminEmail)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: you can only delete developers you added.' },
        { status: 403 }
      );
    }

    // ── 4. Pre-deletion impact counts (for summary only, runs in parallel) ───
    const [
      { count: projectsCount },
      { count: tasksCount },
      { count: submissionsCount },
    ] = await Promise.all([
      supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .or(`assigned_to.eq.${devId},assigned_developer_id.eq.${devId}`),
      supabase
        .from('developer_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('developer_id', devId),
      supabase
        .from('task_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('developer_id', devId),
    ]);

    // ── 5. Collect project IDs that belong to THIS developer only ────────────
    const projectIds = await getProjectIdsForDeveloper(devId);

    // ── 6. Delete child records scoped to the developer's projects ───────────
    //   Leaf-to-root order: submissions → tasks → metrics → logs → projects
    if (projectIds.length > 0) {
      await safeDelete('task_submissions[project]',    supabase.from('task_submissions').delete().in('project_id',   projectIds));
      await safeDelete('developer_tasks[project]',     supabase.from('developer_tasks').delete().in('project_id',   projectIds));
      await safeDelete('productivity_metrics[project]',supabase.from('productivity_metrics').delete().in('project_id', projectIds));
      await safeDelete('activity_logs[project]',       supabase.from('activity_logs').delete().in('project_id',   projectIds));
      await safeDelete('admin_reviews[project]',       supabase.from('admin_reviews').delete().in('project_id',   projectIds));
      await safeDelete('notifications[project]',       supabase.from('notifications').delete().in('project_id',   projectIds));
      await safeDelete('projects',                     supabase.from('projects').delete().in('id',                projectIds));
    }

    // ── 7. Delete child records scoped directly to devId ─────────────────────
    await safeDelete('task_submissions[developer]',    supabase.from('task_submissions').delete().eq('developer_id', devId));
    await safeDelete('developer_tasks[developer]',     supabase.from('developer_tasks').delete().eq('developer_id', devId));
    await safeDelete('productivity_metrics[developer]',supabase.from('productivity_metrics').delete().eq('developer_id', devId));
    await safeDelete('activity_logs[developer]',       supabase.from('activity_logs').delete().eq('developer_id', devId));
    await safeDelete('admin_reviews[developer]',       supabase.from('admin_reviews').delete().eq('developer_id', devId));
    await safeDelete('notifications[developer]',       supabase.from('notifications').delete().eq('developer_id', devId));

    // ── 8. Delete the developer record ───────────────────────────────────────
    const { error: deleteError } = await supabase
      .from('developers')
      .delete()
      .eq('id', devId); // ← strictly scoped to the ONE resolved UUID

    if (deleteError) {
      console.error('[developer/delete] Final delete error:', deleteError);
      return NextResponse.json(
        { success: false, error: `Failed to delete developer record: ${deleteError.message}` },
        { status: 500 }
      );
    }

    // ── 9. Success ────────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      message: `Developer "${developer.name}" and all related data were deleted successfully.`,
      deletionSummary: {
        developer: { id: devId, name: developer.name, email: developer.email },
        relatedDataDeleted: {
          projects:    projectsCount    || 0,
          tasks:       tasksCount       || 0,
          submissions: submissionsCount || 0,
        },
      },
    });
  } catch (err) {
    console.error('[developer/delete] Unexpected error:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred while deleting the developer.',
        detail: err.message,
      },
      { status: 500 }
    );
  }
}

// ─── GET /api/developer/delete?developerId=xxx ────────────────────────────────
/**
 * Dry-run: returns what will be deleted without making any changes.
 * Used by the confirmation dialog to show impact to the admin.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const developerId    = searchParams.get('developerId')    || '';
    const developerEmail = searchParams.get('developerEmail') || '';
    const userId         = searchParams.get('userId')         || '';

    if (!developerId && !developerEmail && !userId) {
      return NextResponse.json(
        { success: false, error: 'A developer identifier (id, email, or userId) is required.' },
        { status: 400 }
      );
    }

    let developer;
    try {
      developer = await resolveDeveloper({ developerId, developerEmail, userId });
    } catch (resolveError) {
      return NextResponse.json(
        { success: false, error: resolveError.message },
        { status: 500 }
      );
    }

    if (!developer) {
      return NextResponse.json(
        {
          success: false,
          error: 'Developer not found.',
          detail: { developerId: developerId || null, developerEmail: developerEmail || null, userId: userId || null },
        },
        { status: 404 }
      );
    }

    const devId = developer.id;

    const [
      { count: projectsCount },
      { count: tasksCount },
      { count: submissionsCount },
      { count: activitiesCount },
    ] = await Promise.all([
      supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .or(`assigned_to.eq.${devId},assigned_developer_id.eq.${devId}`),
      supabase
        .from('developer_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('developer_id', devId),
      supabase
        .from('task_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('developer_id', devId),
      supabase
        .from('activity_logs')
        .select('*', { count: 'exact', head: true })
        .eq('developer_id', devId),
    ]);

    return NextResponse.json({
      success: true,
      developer: { id: devId, name: developer.name, email: developer.email },
      impact: {
        projects:    projectsCount    || 0,
        tasks:       tasksCount       || 0,
        submissions: submissionsCount || 0,
        activities:  activitiesCount  || 0,
      },
      warning:
        (projectsCount || 0) > 0
          ? `This developer has ${projectsCount} project(s). All projects and their tasks will be permanently deleted.`
          : 'This developer has no assigned projects.',
    });
  } catch (err) {
    console.error('[developer/delete] GET error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch deletion impact.' },
      { status: 500 }
    );
  }
}
