import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";
import { buildProjectSummary } from "@/app/api/client/_lib/shapes";

import { readClientRowsIn } from "@/app/api/client/_lib/pagination";

export const dynamic = "force-dynamic";

// GET /api/client/projects
// ClientProjectSummary[] for the projects this client is linked to, scoped to
// their org. progress / open_tasks are computed from CLIENT-VISIBLE tasks only,
// so an internal board full of private work never shows up as client progress.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (auth?.planRefusal) return NextResponse.json(auth.planRefusal, { status: auth.planRefusal.status });
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // No linked projects => nothing to query.
    if (!auth.projectIds.length) {
      return NextResponse.json({ success: true, projects: [] });
    }

    const svc = serviceClient();
    const { data: projects, error } = await readClientRowsIn(auth.projectIds, (ids) => svc
      .from("projects")
      .select("id, name, status, progress, deadline, created_at, description", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .in("id", ids)
      .order("created_at", { ascending: false }).order("id"));

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
    const { data: taskRows, error: tasksError } = await readClientRowsIn(projectIds, (ids) => svc
      .from("developer_tasks")
      .select("id, project_id, status", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .in("project_id", ids)
      .eq("client_visible", true).order("id"));

    if (tasksError) {
      console.error("[client/projects] Tasks error:", tasksError);
      return NextResponse.json(
        { success: false, error: "Failed to load projects" },
        { status: 500 }
      );
    }

    const { data: approvalRows, error: approvalsError } = await readClientRowsIn(projectIds, (ids) => svc
      .from("approvals")
      .select("id, project_id", { count: "exact" })
      .eq("organization_id", auth.orgId)
      .in("project_id", ids)
      .eq("status", "pending").order("id"));

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

    const summaries = (projects || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id))).map((project) =>
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
