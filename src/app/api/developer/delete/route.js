import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getAuthedOrg } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Resolve the person being deleted, INSIDE the caller's organization.
 *
 * The org filter is new. `resolveDeveloper` runs with the service role, which
 * bypasses RLS, and the email branch used `.maybeSingle()` on an unfiltered
 * `ilike` — so on an install where the same address works for two tenants the
 * lookup either errored ("multiple rows") or resolved whichever row Postgres
 * handed back first. The explicit `developer.organization_id !== auth.orgId`
 * checks in both handlers below are KEPT, not replaced: this narrows what can
 * be found, those two prove what was found is ours.
 */
async function resolveDeveloper({ developerId, developerEmail, userId, orgId }) {
  const normalizedId = normalize(developerId);
  const normalizedEmail = normalize(developerEmail).toLowerCase();
  const columns =
    // `auth_user_id` is selected because deletion has to revoke the LOGIN, not
    // just the profile row. See the revocation step in DELETE.
    'id, name, email, organization_id, auth_user_id, added_by, added_by_admin, added_by_name';

  if (normalizedId) {
    const { data, error } = await supabase
      .from('developers')
      .select(columns)
      .eq('id', normalizedId)
      .eq('organization_id', orgId)
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
      .select(columns)
      .ilike('email', normalizedEmail)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!error && data) return data;
  }

  return null;
}

/**
 * Did THIS admin add this person?
 *
 * THIS FUNCTION WAS DEAD. It was defined here and called from nowhere, while
 * src/utils/developerDeletion.js ran the same comparison in the browser and its
 * comment claimed "The route repeats it against the caller's verified token".
 * It did not. A rule that only exists in the client is not a rule; anybody who
 * can send a DELETE never sees it.
 *
 * It is wired in below, with two deliberate differences from the browser copy:
 *
 *   1. The identity compared is the one from the VERIFIED TOKEN, never the
 *      `adminId`/`adminEmail` in the request body. Those are caller-supplied
 *      strings and using them would make this check self-certifying.
 *   2. An OWNER is exempt. Somebody has to be able to clean up after an admin
 *      who has themselves left, and "the person who added them is gone" must
 *      not mean "this row can never be removed". An owner deleting a member
 *      they did not add is a deliberate act by the top of the organization;
 *      an admin doing it to another admin's report is not.
 *
 * The attribution columns are sparsely populated on older rows, so a row that
 * records no adder at all is not refused — there is nothing to compare, and
 * failing closed there would strand every pre-attribution account.
 */
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

/** True when the row records nobody as its adder — nothing to compare against. */
function hasOwnershipInfo(developer) {
  return Boolean(normalize(developer?.added_by) || normalize(developer?.added_by_admin));
}

/**
 * The projects this person is assigned to — NOT "their" projects.
 *
 * The distinction is the whole of the fix below. A project belongs to the
 * organization; the assignment is a pointer, and a pointer to somebody who has
 * left is cleared, not followed with a DELETE.
 *
 * Both queries now carry `organization_id`. `devId` is a uuid primary key that
 * has already been proved to be in the caller's org, so this is belt and
 * braces — but these run with the service role, and a service-role query with
 * no tenant predicate is exactly the shape that later gets copied somewhere it
 * matters.
 */
async function getProjectIdsForDeveloper(developerId, orgId) {
  const projectIdSet = new Set();

  const { data: projectsByAssignedTo } = await supabase
    .from('projects')
    .select('id')
    .eq('organization_id', orgId)
    .eq('assigned_to', developerId);

  (projectsByAssignedTo || []).forEach((p) => projectIdSet.add(p.id));

  const { data: projectsByAssignedDev } = await supabase
    .from('projects')
    .select('id')
    .eq('organization_id', orgId)
    .eq('assigned_developer_id', developerId);

  (projectsByAssignedDev || []).forEach((p) => projectIdSet.add(p.id));

  return Array.from(projectIdSet);
}

/**
 * What deleting this person actually removes.
 *
 * ONE function, used by the preview AND by the summary the DELETE returns, so
 * the two cannot disagree. They used to: the dialog counted `developer_id`
 * rows ("Tasks: 41") while the delete removed every task on every project the
 * person was assigned to, including everybody else's. The counts were honest
 * about a delete that was not.
 *
 * `projects` is a count of projects that will be UNASSIGNED. It is reported
 * separately from `relatedDataDeleted` for that reason.
 */
async function impactForDeveloper(devId, orgId) {
  const [
    projectIds,
    { count: tasksCount },
    { count: submissionsCount },
    { count: activitiesCount },
  ] = await Promise.all([
    getProjectIdsForDeveloper(devId, orgId),
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

  return {
    projectIds,
    projects: projectIds.length,
    tasks: tasksCount || 0,
    submissions: submissionsCount || 0,
    activities: activitiesCount || 0,
  };
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
 * Safely delete one specific developer and the data that is theirs alone.
 *
 * WHAT THIS ROUTE USED TO DO, AND WHY IT WAS THE WORST BUG IN THE PRODUCT
 *
 * It collected every project the person was assigned to and then deleted
 * `task_submissions`, `developer_tasks`, `productivity_metrics`,
 * `activity_logs`, `admin_reviews`, `notifications` and the PROJECTS THEMSELVES
 * by `project_id`. Not by developer. So removing one leaver destroyed every
 * other contributor's tasks and their submitted proof-of-work on every project
 * that leaver had touched, and destroyed the projects too — client-facing rows
 * with budgets and deadlines hanging off them. "Delete a developer" was
 * "delete a slice of the company".
 *
 * It now removes ONLY rows keyed to this person, and CLEARS the assignment on
 * their projects instead of deleting them. The preview and this handler read
 * their counts from the same function, so what the dialog promises is what
 * happens.
 *
 * ORDER OF OPERATIONS, AND WHY IT IS THIS ONE
 *
 *   1. Revoke the LOGIN (auth.admin.deleteUser). Nothing else runs if this
 *      fails, so a failure leaves the account intact rather than half-erased.
 *   2. Remove the MEMBERSHIP, which is what `entitlements.js` counts as a paid
 *      seat.
 *   3. Only then unassign, purge and delete the profile row.
 *
 * Access first is the safe direction. Interrupted after (1) or (2) the person
 * is locked out with their data intact, which is recoverable and is also
 * exactly what re-running this request finishes. Interrupted the other way
 * round, the data would be gone and they could still sign in.
 *
 * Body (JSON):
 *   developerId    {string}  UUID primary key of the developer  ← strongly preferred
 *   developerEmail {string}  Fallback – only used when developerId is absent
 *   userId         {string}  Fallback – only used when developerId is absent
 *   adminId        {string}  UUID of the requesting admin  (context only, see below)
 *   adminEmail     {string}  Email of the requesting admin (context only, see below)
 */
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { developerId, developerEmail, userId, adminId, adminEmail } = body;

    // ── 0. JWT authorization (fail-closed) ───────────────────────────────────
    // Require a valid Supabase Auth token. This blocks any unauthenticated
    // caller and any authenticated non-admin from calling this destructive
    // route.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    // A PERMISSION, NOT A HAND-TYPED ROLE LIST. This used to read
    // `["owner","admin"].includes(auth.role)`, which admits the same two roles
    // and NOTHING ELSE — in particular it does not consult the per-person
    // overrides added in migration 069. A DENY written against one named admin
    // was honoured on every other route in the product and ignored on the most
    // destructive one. `member.delete` resolves to the same owner/admin default
    // (see permissionCatalogue.js) and then applies the override.
    const denied = requirePermission(auth, 'member.delete');
    if (denied) return denied;

    // ── 1. Input validation ──────────────────────────────────────────────────
    if (!developerId && !developerEmail && !userId) {
      return NextResponse.json(
        { success: false, error: 'A developer identifier (id, email, or userId) is required.' },
        { status: 400 }
      );
    }
    // Kept because the client sends them and their absence signals a caller
    // that has lost track of who it is. They are NOT used to authorize
    // anything: everything below compares against `auth`, which came from a
    // verified token, because a body can say whatever it likes.
    if (!adminId || !adminEmail) {
      return NextResponse.json(
        { success: false, error: 'Admin credentials (adminId and adminEmail) are required.' },
        { status: 401 }
      );
    }

    // ── 2. Resolve developer – strict UUID-first, no silent fallback ─────────
    let developer;
    try {
      developer = await resolveDeveloper({
        developerId,
        developerEmail,
        userId,
        orgId: auth.orgId,
      });
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

    // Cross-org guard: an admin may only delete developers inside their own
    // organization. Org + role from the JWT is the sole authority here.
    if (developer.organization_id !== auth.orgId) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: this developer belongs to another organization.' },
        { status: 403 }
      );
    }

    // ── 3. Who may delete THIS person ────────────────────────────────────────
    // Deleting yourself would revoke the login of the session making the
    // request, leaving the rest of this handler running on behalf of an account
    // that no longer exists — and, if you are the last owner, nobody able to
    // undo it.
    if (
      String(devId) === String(auth.appUserId || '') ||
      (developer.auth_user_id && String(developer.auth_user_id) === String(auth.userId || ''))
    ) {
      return NextResponse.json(
        { success: false, error: 'You cannot delete your own account from here.' },
        { status: 400 }
      );
    }

    // The ownership rule the browser has always shown, now enforced where it
    // counts. See isAdminAuthorizedForDeveloper for the owner exemption and for
    // why the comparison uses the token and not the body.
    if (
      auth.role !== 'owner' &&
      hasOwnershipInfo(developer) &&
      !isAdminAuthorizedForDeveloper(developer, auth.appUserId, auth.email)
    ) {
      return NextResponse.json(
        { success: false, error: 'You can only delete developers you added.' },
        { status: 403 }
      );
    }

    // ── 4. Pre-deletion impact counts (the same numbers the preview showed) ──
    const impact = await impactForDeveloper(devId, auth.orgId);

    // ── 5. Revoke access BEFORE destroying anything ─────────────────────────
    // DELETION USED TO REVOKE NOTHING. The word "memberships" did not appear in
    // this file, and neither did `auth.admin`. So a deleted person kept a
    // Supabase Auth account and a valid JWT carrying organization_id, role and
    // app_user_id — and getAuthedOrg treats a MISSING membership row as active
    // (legacy accounts) — which means the deleted employee could still sign in
    // and still pass every route guard. Their seat also kept counting against
    // the plan, because entitlements.js counts membership rows.
    //
    // The login goes first because it is the only one of the two that actually
    // stops them.
    let loginRevoked = false;
    if (developer.auth_user_id) {
      const { error: authErr } = await supabase.auth.admin.deleteUser(developer.auth_user_id);
      // "User not found" means a previous run already got this far. That is a
      // finished step, not a failure — this handler has to be safe to retry.
      const alreadyGone =
        authErr && (authErr.status === 404 || /not found/i.test(authErr.message || ''));
      if (authErr && !alreadyGone) {
        console.error('[developer/delete] auth user delete failed:', authErr);
        return NextResponse.json(
          {
            success: false,
            error:
              'Could not revoke this person\'s login, so nothing was deleted. Try again.',
          },
          { status: 503 }
        );
      }
      loginRevoked = true;
    }
    // A row with no auth_user_id has no login to revoke THAT WE CAN FIND. The
    // link is backfilled by database/052_repair_auth_claims.sql; if it is still
    // null on an old row and an Auth account exists under the same address, it
    // survives this delete. That is reported in the response rather than
    // guessed at, because deleting an Auth user found by email alone is how the
    // wrong account gets removed.

    // The paid seat. Not pinned to user_type: a profile in `developers` only
    // ever gets a 'developer' membership, and not pinning it also sweeps a
    // stale row that would otherwise keep counting against the plan forever.
    await safeDelete(
      'memberships',
      supabase.from('memberships').delete().eq('organization_id', auth.orgId).eq('user_id', devId)
    );

    // ── 6. Unassign, never delete, the projects ─────────────────────────────
    // The projects stay. They are the organization's work, with a client, a
    // budget and a deadline on them; the leaver was a pointer. Clearing the
    // pointer also keeps the `developers` delete below from tripping a foreign
    // key on installs that have one.
    if (impact.projectIds.length > 0) {
      await safeDelete(
        'projects[assigned_to]',
        supabase
          .from('projects')
          .update({ assigned_to: null })
          .eq('organization_id', auth.orgId)
          .eq('assigned_to', devId)
      );
      await safeDelete(
        'projects[assigned_developer_id]',
        supabase
          .from('projects')
          .update({ assigned_developer_id: null })
          .eq('organization_id', auth.orgId)
          .eq('assigned_developer_id', devId)
      );
    }

    // ── 7. Delete the rows that are this person's and nobody else's ─────────
    // Scoped by `developer_id` ONLY. Every one of these used to run a second
    // time keyed on `project_id`, which is what destroyed other people's work.
    //
    // No `organization_id` predicate here on purpose: `devId` is a uuid primary
    // key already proved to belong to this org, and `safeDelete` swallows
    // "column does not exist" (42703) — so adding an org filter to a table that
    // lacks the column would turn the delete into a silent no-op while still
    // reporting success. Narrower is not safer when the narrowing can vanish.
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
      .eq('id', devId) // ← strictly scoped to the ONE resolved UUID
      .eq('organization_id', auth.orgId);

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
      message: `Developer "${developer.name}" and their own data were deleted successfully.`,
      deletionSummary: {
        developer: { id: devId, name: developer.name, email: developer.email },
        accessRevoked: {
          // `login: false` with no auth_user_id on the row is the case
          // described above — say so instead of implying a revocation.
          login: loginRevoked,
          membership: true,
        },
        projectsUnassigned: impact.projects,
        relatedDataDeleted: {
          tasks:       impact.tasks,
          submissions: impact.submissions,
          activities:  impact.activities,
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
 *
 * The numbers come from the SAME function the DELETE uses. The dialog is a
 * promise about what the next request will do, and a promise computed by
 * different code than the thing it describes is a promise that drifts — it had
 * already: "Tasks: 41" beside a delete that removed every task on those
 * projects.
 */
export async function GET(request) {
  try {
    // Same fail-closed guard as DELETE (read-only impact preview).
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const denied = requirePermission(auth, 'member.delete');
    if (denied) return denied;

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
      developer = await resolveDeveloper({
        developerId,
        developerEmail,
        userId,
        orgId: auth.orgId,
      });
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

    // CROSS-TENANT DISCLOSURE, fixed. The DELETE handler below has always had
    // this check; the GET preview never did. `resolveDeveloper` looks the
    // person up with the SERVICE ROLE, which bypasses RLS, so an owner or admin
    // of any organization could pass another tenant's developer id or email and
    // get back their name, their email, and how many projects, tasks and
    // submissions they hold. Everything above this line — authentication, the
    // owner/admin role gate — passes for that caller, because they really are
    // an owner. Of a different company.
    //
    // The 404 is deliberately the same one an unknown id gets: telling a
    // stranger "exists, but not yours" is most of the disclosure.
    if (developer.organization_id !== auth.orgId) {
      return NextResponse.json(
        { success: false, error: 'Developer not found.' },
        { status: 404 }
      );
    }

    const devId = developer.id;

    const impact = await impactForDeveloper(devId, auth.orgId);

    return NextResponse.json({
      success: true,
      developer: { id: devId, name: developer.name, email: developer.email },
      impact: {
        projects:    impact.projects,
        tasks:       impact.tasks,
        submissions: impact.submissions,
        activities:  impact.activities,
      },
      // WHAT THE PROJECT COUNT MEANS CHANGED WITH THE FIX. It used to warn that
      // the projects and everything on them would be destroyed, which is what
      // the route did. They are now left standing and merely unassigned, so the
      // warning says that instead — a dialog that overstates the damage trains
      // people to click through the one that does not.
      warning:
        impact.projects > 0
          ? `This person is assigned to ${impact.projects} project(s). Those projects are KEPT — they are left in place with no one assigned. Only this person's own tasks, submissions and activity are deleted.`
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
