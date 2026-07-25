import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/client/projects/[id]
// Full project detail: milestones, tasks, updates and deliverables — all
// scoped to the client's org and limited to a project they are linked to.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params?.id;
    if (!clientCanAccessProject(auth, projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const svc = serviceClient();

    const { data: project, error: projectError } = await svc
      .from("projects")
      .select("id, name, description, status, progress, deadline, created_at")
      .eq("organization_id", auth.orgId)
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      console.error("[client/projects/:id] Project error:", projectError);
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { data: milestones, error: milestonesError } = await svc
      .from("milestones")
      .select("id, title, description, due_date, status, sort_order, created_at")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("due_date", { ascending: true });

    if (milestonesError) {
      console.error("[client/projects/:id] Milestones error:", milestonesError);
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
    }

    const { data: taskRows, error: tasksError } = await svc
      .from("developer_tasks")
      .select("id, task_title, status, created_at, end_date")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .order("task_order", { ascending: true });

    if (tasksError) {
      console.error("[client/projects/:id] Tasks error:", tasksError);
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
    }

    // Expose only client-safe task fields; map end_date -> due_date.
    const tasks = (taskRows || []).map((t) => ({
      id: t.id,
      task_title: t.task_title,
      status: t.status,
      created_at: t.created_at,
      due_date: t.end_date || null,
    }));

    const { data: updates, error: updatesError } = await svc
      .from("project_updates")
      .select("id, title, body, author_name, created_at")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (updatesError) {
      console.error("[client/projects/:id] Updates error:", updatesError);
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
    }

    const { data: subRows, error: subsError } = await svc
      .from("task_submissions")
      .select("id, file_name, file_type, file_size, submitted_at, review_status, developer_tasks(task_title)")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .order("submitted_at", { ascending: false });

    if (subsError) {
      console.error("[client/projects/:id] Deliverables error:", subsError);
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
    }

    // Only client-safe deliverable fields (no developer_id / internal notes).
    const deliverables = (subRows || []).map((s) => ({
      id: s.id,
      file_name: s.file_name,
      file_type: s.file_type,
      file_size: s.file_size,
      created_at: s.submitted_at,
      task_title: s.developer_tasks?.task_title || null,
      review_status: s.review_status,
    }));

    const { data: approvals, error: approvalsError } = await svc
      .from("approvals")
      .select("id, item_type, item_ref, title, description, status, decided_by, decided_at, note, created_at")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (approvalsError) {
      console.error("[client/projects/:id] Approvals error:", approvalsError);
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
    }

    return NextResponse.json({
      project,
      milestones: milestones || [],
      tasks,
      updates: updates || [],
      deliverables,
      approvals: approvals || [],
    });
  } catch (err) {
    console.error("[client/projects/:id] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
