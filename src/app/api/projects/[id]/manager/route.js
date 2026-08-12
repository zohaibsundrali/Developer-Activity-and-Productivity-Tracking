import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/[id]/manager — set, change or clear a project's manager.
 *
 * WHY THIS EXISTS
 *
 * `projects.manager_id` was written in exactly ONE place: accepting a client
 * proposal. Every other project — anything created from All Projects, cloned
 * from a template, or imported — had no way to ever get a manager, and a
 * project whose manager left had no way to get a new one.
 *
 * The consequences were not cosmetic:
 *
 *   - Team Structure's "Without a manager" section was permanently stuck for
 *     those projects, which is the section that exists to be acted on.
 *   - Capacity could not count a project against whoever actually runs it.
 *   - The closure gate reads `manager_id` to decide who may mark work complete
 *     (see mayManage in ../closure/route.js). With it permanently null, that
 *     check falls back to "any manager or team lead", which is looser than
 *     intended and could never be tightened.
 *
 * WHY IT IS A ROUTE AND NOT A BROWSER WRITE
 *
 * This column carries authority. mayManage() grants the named manager the
 * right to mark a project complete, so anyone able to write it could grant
 * themselves that right on any project. It is therefore decided here, against
 * the caller's verified token, by the same two roles that assign a manager
 * when a proposal is accepted.
 *
 * OWNER AND ADMIN ONLY, deliberately narrower than `create_project`. A manager
 * who could reassign projects could hand themselves every project in the
 * organization; deciding who runs what is the founder's or an admin's call.
 */

// Who may be given a project. The same list /api/proposals/[id]/decide checks,
// because a manager assigned at acceptance and one assigned later must mean
// the same thing.
const ELIGIBLE_MANAGER_ROLES = ["owner", "admin", "manager", "team_lead"];

export async function POST(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (auth.userType === "client" || !["owner", "admin"].includes(auth.role)) {
      return NextResponse.json(
        { error: "Only an owner or admin can change a project's manager." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    // `null` is a real instruction here — "this project has no manager" — and
    // is distinct from the field being absent.
    const managerId = body.managerId ? String(body.managerId) : null;

    const svc = serviceClient();

    // serviceClient bypasses RLS, so the organization filter IS the tenant
    // boundary on both reads below. It is not a hint.
    const { data: project } = await svc
      .from("projects")
      .select("id, name, manager_id")
      .eq("id", params?.id)
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

    let manager = null;
    if (managerId) {
      // A named manager must actually be one, and be in THIS organization.
      // Without this the field is a free-text uuid that lands in the project
      // and silently assigns it to nobody — the same check the decide route
      // makes, for the same reason.
      const { data: mgr } = await svc
        .from("memberships")
        .select("user_id, role, status, email, user_type")
        .eq("organization_id", auth.orgId)
        .eq("user_id", managerId)
        .eq("status", "active")
        .maybeSingle();

      if (!mgr) {
        return NextResponse.json(
          { error: "That person is not an active member of this organization." },
          { status: 400 }
        );
      }
      if (!ELIGIBLE_MANAGER_ROLES.includes(mgr.role)) {
        return NextResponse.json(
          { error: `A ${String(mgr.role).replace(/_/g, " ")} cannot be a project manager.` },
          { status: 400 }
        );
      }
      manager = mgr;
    }

    if (String(project.manager_id || "") === String(managerId || "")) {
      // Not an error — the caller asked for a state the project is already in.
      // Reporting it as a failure would make a double-click look broken.
      return NextResponse.json({ success: true, unchanged: true, managerId });
    }

    const { error } = await svc
      .from("projects")
      .update({ manager_id: managerId, updated_at: new Date().toISOString() })
      .eq("id", project.id)
      .eq("organization_id", auth.orgId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Best effort from here down. The assignment is saved; failing to announce
    // it must not be reported as the assignment having failed.
    try {
      await svc.from("pm_activity").insert({
        organization_id: auth.orgId,
        project_id: project.id,
        entity_type: "project",
        entity_id: project.id,
        action: managerId ? "project_manager_assigned" : "project_manager_cleared",
        actor_id: auth.appUserId || null,
        meta: { previousManagerId: project.manager_id || null, managerId },
      });
    } catch {
      /* nobody is worse off for a missing activity row */
    }

    if (manager) {
      try {
        const { notify } = await import("@/utils/notifications");
        await notify({
          audience: manager.user_type === "admin" ? "admin" : "developer",
          recipientId: manager.user_id,
          recipientEmail: manager.user_type === "admin" ? manager.email || null : null,
          category: "project",
          type: "project_manager_assigned",
          title: "You are running a project",
          message: `You were made project manager of ${project.name || "a project"}.`,
          projectId: project.id,
          entityType: "project",
          entityId: project.id,
          // Being handed a project is news every time it happens, but the same
          // save landing twice is not.
          dedupeKey: `project_manager_assigned:${project.id}:${manager.user_id}`,
        });
      } catch {
        /* the assignment is saved — announcing it must not fail the request */
      }
    }

    return NextResponse.json({ success: true, managerId });
  } catch {
    return NextResponse.json({ error: "The manager could not be changed." }, { status: 500 });
  }
}
