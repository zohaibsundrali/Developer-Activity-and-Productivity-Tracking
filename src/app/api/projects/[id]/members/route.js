import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { mayActOnProject, withProjectRoles } from "@/utils/projectAccess";
import { PROJECT_ROLES } from "@/utils/roles";

export const dynamic = "force-dynamic";

/**
 * GET    /api/projects/[id]/members — who is on this project
 * POST   /api/projects/[id]/members — put someone on it, in a capacity
 * DELETE /api/projects/[id]/members — take someone off it
 *
 * WHAT WAS MISSING, AND IT WAS NOT A SCREEN
 *
 * `permissionEngine.js` has always accepted a `projectRoles` map and a
 * `scope.projectId`, and nothing has ever supplied either — the identifier
 * appears nowhere in the repository outside that one file and its comments.
 * Half the permission engine was unreachable.
 *
 * The reason it stayed unreachable is that the database could not answer the
 * question. `projects.assigned_to` holds ONE developer and `projects.manager_id`
 * ONE manager; task assignment is a consequence of being on a project, not a
 * statement of role on it. Nothing could say "three developers, a designer and
 * a QA, and Ayesha leads". Migration 071 adds that table; this route writes it.
 *
 * THE TWO CHECKS ARE DIFFERENT QUESTIONS, AND BOTH ARE ASKED
 *
 *   requirePermission(...)  — may this KIND of person do this kind of thing?
 *   mayActOnProject(...)    — on THIS project?
 *
 * Only the first exists anywhere else in this codebase, which is why every
 * `manager` permission is organization-wide and a project manager can edit all
 * forty projects in the company. The second is the half that scopes it. Owner
 * and admin bypass it by design — they see the whole company.
 *
 * A permission alone cannot express the second question: resolvePermission ORs
 * the project role with the organization role, so it can only ever GRANT. That
 * asymmetry is deliberate and documented in utils/projectAccess.js.
 */

/**
 * The shape every response uses, so the client never branches on which verb it
 * called.
 *
 * `canManage` is answered by the SERVER, not inferred in the browser. The
 * client-side helper `allowed(key)` builds its subject from the role alone and
 * has no project roles in it, so it can only ever answer the organization-wide
 * question — it would show the controls to every manager in the company and
 * each of them would get a 404 on use. This is the same fact the route already
 * computed; sending it costs nothing and is the only way the UI can be right.
 */
function membersPayload(rows, canManage = false) {
  return {
    success: true,
    canManage,
    members: (rows || []).map((r) => ({
      userId: r.user_id,
      userType: r.user_type,
      projectRole: r.project_role,
      allocationPct: r.allocation_pct,
      addedAt: r.created_at,
    })),
  };
}

/**
 * Resolve the project inside the caller's organization, or answer 404.
 *
 * serviceClient bypasses RLS, so the organization filter IS the tenant
 * boundary — not a hint. 404 rather than 403 for a project in another
 * organization: a 403 confirms the id exists somewhere, and iterating ids
 * against a route that distinguishes the two maps out another company's work.
 * The same reasoning as client/tasks/_lib/clientTask.js.
 */
async function resolveProject(svc, projectId, orgId) {
  if (!projectId) return null;
  const { data } = await svc
    .from("projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data || null;
}

async function listMembers(svc, projectId, orgId) {
  const { data } = await svc
    .from("project_members")
    .select("user_id, user_type, project_role, allocation_pct, created_at")
    .eq("project_id", projectId)
    .eq("organization_id", orgId)
    .order("project_role", { ascending: true });
  return data || [];
}

export async function GET(request, { params }) {
  try {
    let auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (auth.userType === "client") {
      // The staffing of a client's project is not the client's to see — the
      // same line 014 draws when it excludes clients from `memberships`.
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const projectId = params?.id;
    const svc = serviceClient();

    const project = await resolveProject(svc, projectId, auth.orgId);
    if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // Reading the roster needs no catalogue permission — being on the project,
    // or being owner/admin, is the whole rule. Anyone who can see the project
    // can see who is on it.
    auth = await withProjectRoles(auth, svc, projectId);
    if (!mayActOnProject(auth, projectId, auth.projectRoles)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const canManage =
      !requirePermission(auth, "project.manage_members", { projectId }) &&
      mayActOnProject(auth, projectId, auth.projectRoles);

    return NextResponse.json(
      membersPayload(await listMembers(svc, projectId, auth.orgId), canManage)
    );
  } catch (err) {
    console.error("[projects/members] GET failed:", err);
    return NextResponse.json({ error: "Could not load the project team." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    let auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = params?.id;
    const svc = serviceClient();

    const project = await resolveProject(svc, projectId, auth.orgId);
    if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // Loaded BEFORE the permission check, because the permission is one a
    // project role can satisfy: a `manager` on this project holds
    // project.manage_members through the projectRoles branch even without the
    // organization-wide role.
    auth = await withProjectRoles(auth, svc, projectId);

    const denied = requirePermission(auth, "project.manage_members", { projectId });
    if (denied) return denied;

    // Second question. requirePermission said this KIND of person may staff a
    // project; this says whether it is THIS one. An org-wide manager who is not
    // on the project gets a 404, the same answer a project in another tenant
    // gets, for the same reason.
    if (!mayActOnProject(auth, projectId, auth.projectRoles)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = body?.userId ? String(body.userId) : null;
    const projectRole = String(body?.projectRole || "").trim();

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (!PROJECT_ROLES.includes(projectRole)) {
      // Named rather than "invalid": the caller is a colleague's UI, and the
      // list is short and stable.
      return NextResponse.json(
        { error: `projectRole must be one of: ${PROJECT_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    // Allocation is optional and bounded. Absent stays NULL — inventing 100
    // would make the capacity screen confidently wrong about every backfilled
    // row, which is worse than it admitting it does not know.
    let allocationPct = null;
    if (body?.allocationPct !== undefined && body?.allocationPct !== null && body?.allocationPct !== "") {
      const n = Number(body.allocationPct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json(
          { error: "allocationPct must be a number between 0 and 100" },
          { status: 400 }
        );
      }
      allocationPct = Math.round(n);
    }

    // The person must be an active member of THIS organization. Without this
    // the field is a free-text uuid that silently puts nobody on the project —
    // the same check /api/projects/[id]/manager makes, for the same reason.
    const { data: membership } = await svc
      .from("memberships")
      .select("user_id, user_type, status")
      .eq("organization_id", auth.orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: "That person is not an active member of this organization." },
        { status: 400 }
      );
    }
    if (membership.user_type === "client") {
      return NextResponse.json(
        { error: "A client cannot be a member of the project team." },
        { status: 400 }
      );
    }

    const { error } = await svc
      .from("project_members")
      .upsert(
        {
          organization_id: auth.orgId,
          project_id: projectId,
          user_id: userId,
          user_type: membership.user_type === "admin" ? "admin" : "developer",
          project_role: projectRole,
          allocation_pct: allocationPct,
          added_by: auth.appUserId || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id,user_id" }
      );

    if (error) {
      console.error("[projects/members] upsert failed:", error);
      return NextResponse.json({ error: "Could not update the project team." }, { status: 500 });
    }

    return NextResponse.json(membersPayload(await listMembers(svc, projectId, auth.orgId), true));
  } catch (err) {
    console.error("[projects/members] POST failed:", err);
    return NextResponse.json({ error: "Could not update the project team." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    let auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectId = params?.id;
    const svc = serviceClient();

    const project = await resolveProject(svc, projectId, auth.orgId);
    if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

    auth = await withProjectRoles(auth, svc, projectId);
    const denied = requirePermission(auth, "project.manage_members", { projectId });
    if (denied) return denied;
    if (!mayActOnProject(auth, projectId, auth.projectRoles)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = body?.userId ? String(body.userId) : null;
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    // THE PROJECT MANAGER IS NOT REMOVED HERE. `projects.manager_id` is the
    // authority for who runs a project and a trigger (071) keeps the matching
    // row in step; deleting the row underneath it would put the two into
    // exactly the disagreement that trigger exists to prevent. Reassign through
    // /api/projects/[id]/manager instead.
    const { data: existing } = await svc
      .from("project_members")
      .select("project_role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing?.project_role === "manager") {
      return NextResponse.json(
        {
          error:
            "This person manages the project. Assign a different manager first, then remove them.",
        },
        { status: 409 }
      );
    }

    const { error } = await svc
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("organization_id", auth.orgId)
      .eq("user_id", userId);

    if (error) {
      console.error("[projects/members] delete failed:", error);
      return NextResponse.json({ error: "Could not update the project team." }, { status: 500 });
    }

    return NextResponse.json(membersPayload(await listMembers(svc, projectId, auth.orgId), true));
  } catch (err) {
    console.error("[projects/members] DELETE failed:", err);
    return NextResponse.json({ error: "Could not update the project team." }, { status: 500 });
  }
}
