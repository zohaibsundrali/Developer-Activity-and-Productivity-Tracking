import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";
import { buildProjectSummary } from "@/app/api/client/_lib/shapes";

export const dynamic = "force-dynamic";

// GET /api/client/projects
// ClientProjectSummary[] for the projects this client is linked to, scoped to
// their org. progress / open_tasks are computed from CLIENT-VISIBLE tasks only,
// so an internal board full of private work never shows up as client progress.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // No linked projects => nothing to query.
    if (!auth.projectIds.length) {
      return NextResponse.json({ success: true, projects: [] });
    }

    const svc = serviceClient();
    const { data: projects, error } = await svc
      .from("projects")
      .select("id, name, status, progress, deadline, created_at, description")
      .eq("organization_id", auth.orgId)
      .in("id", auth.projectIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[client/projects] Query error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to load projects" },
        { status: 500 }
      );
    }

    const projectIds = (projects || []).map((p) => p.id);
    if (!projectIds.length) {
      return NextResponse.json({ success: true, projects: [] });
    }

    // Counts come from client-visible tasks only (migration 032).
    const { data: taskRows, error: tasksError } = await svc
      .from("developer_tasks")
      .select("id, project_id, status")
      .eq("organization_id", auth.orgId)
      .in("project_id", projectIds)
      .eq("client_visible", true);

    if (tasksError) {
      console.error("[client/projects] Tasks error:", tasksError);
      return NextResponse.json(
        { success: false, error: "Failed to load projects" },
        { status: 500 }
      );
    }

    const { data: approvalRows, error: approvalsError } = await svc
      .from("approvals")
      .select("id, project_id")
      .eq("organization_id", auth.orgId)
      .in("project_id", projectIds)
      .eq("status", "pending");

    if (approvalsError) {
      console.error("[client/projects] Approvals error:", approvalsError);
      return NextResponse.json(
        { success: false, error: "Failed to load projects" },
        { status: 500 }
      );
    }

    // Bucket the counts by project so each summary is built from its own rows.
    const tasksByProject = new Map();
    for (const t of taskRows || []) {
      const list = tasksByProject.get(t.project_id) || [];
      list.push(t);
      tasksByProject.set(t.project_id, list);
    }

    const pendingByProject = new Map();
    for (const a of approvalRows || []) {
      pendingByProject.set(a.project_id, (pendingByProject.get(a.project_id) || 0) + 1);
    }

    const summaries = (projects || []).map((project) =>
      buildProjectSummary({
        project,
        tasks: tasksByProject.get(project.id) || [],
        pendingApprovals: pendingByProject.get(project.id) || 0,
      })
    );

    return NextResponse.json({ success: true, projects: summaries });
  } catch (err) {
    console.error("[client/projects] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
