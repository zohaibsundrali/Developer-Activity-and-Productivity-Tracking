import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";
import { buildProjectSummary } from "@/app/api/client/_lib/shapes";

export const dynamic = "force-dynamic";

// GET /api/client/projects/[id]
// ClientProjectDetail: milestones, tasks, team, updates and deliverables — all
// scoped to the client's org and limited to a project they are linked to.
//
// THE FIX: this route used to return EVERY task on the project, so internal
// task titles ("chase the client about the overdue invoice") were read by the
// client verbatim. Tasks, milestones and updates are now filtered on
// client_visible = true (migration 032), and the team is name + role only —
// no email, no employee_profiles, nothing from the HR module.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params?.id;
    if (!clientCanAccessProject(auth, projectId)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const svc = serviceClient();

    const { data: project, error: projectError } = await svc
      .from("projects")
      .select(
        "id, name, description, status, progress, deadline, start_date, end_date, assigned_to, created_at"
      )
      .eq("organization_id", auth.orgId)
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      console.error("[client/projects/:id] Project error:", projectError);
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const { data: milestoneRows, error: milestonesError } = await svc
      .from("milestones")
      .select("id, title, due_date, status, sort_order, updated_at")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .eq("client_visible", true)
      .order("sort_order", { ascending: true })
      .order("due_date", { ascending: true });

    if (milestonesError) {
      console.error("[client/projects/:id] Milestones error:", milestonesError);
      return NextResponse.json(
        { success: false, error: "Failed to load project" },
        { status: 500 }
      );
    }

    // `milestones` has no completed_at column; the row is stamped on update, so
    // a completed milestone's updated_at is when it was completed.
    const milestones = (milestoneRows || []).map((m) => ({
      id: m.id,
      title: m.title,
      due_date: m.due_date || null,
      status: m.status,
      completed_at: m.status === "completed" ? m.updated_at || null : null,
    }));

    const { data: taskRows, error: tasksError } = await svc
      .from("developer_tasks")
      .select(
        "id, task_title, status, priority, labels, due_date, end_date, developer_id, task_order"
      )
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .eq("client_visible", true)
      .order("task_order", { ascending: true });

    if (tasksError) {
      console.error("[client/projects/:id] Tasks error:", tasksError);
      return NextResponse.json(
        { success: false, error: "Failed to load project" },
        { status: 500 }
      );
    }

    const visibleTaskIds = (taskRows || []).map((t) => t.id);

    // Attachment counts for the visible tasks only — a count, never a path.
    let attachmentCounts = new Map();
    if (visibleTaskIds.length) {
      const { data: attachmentRows, error: attachmentsError } = await svc
        .from("task_attachments")
        .select("id, task_id")
        .eq("organization_id", auth.orgId)
        .in("task_id", visibleTaskIds);

      if (attachmentsError) {
        console.error("[client/projects/:id] Attachments error:", attachmentsError);
        return NextResponse.json(
          { success: false, error: "Failed to load project" },
          { status: 500 }
        );
      }

      attachmentCounts = (attachmentRows || []).reduce((acc, a) => {
        acc.set(a.task_id, (acc.get(a.task_id) || 0) + 1);
        return acc;
      }, new Map());
    }

    // The people the client may be told about: whoever is assigned to a
    // client-visible task, plus the project lead. Name and role ONLY — the
    // select never asks for an email, and employee_profiles is not touched.
    const memberIds = [];
    for (const t of taskRows || []) {
      if (t.developer_id && !memberIds.includes(t.developer_id)) memberIds.push(t.developer_id);
    }
    if (project.assigned_to && !memberIds.includes(project.assigned_to)) {
      memberIds.push(project.assigned_to);
    }

    // `designation` is NOT a column on `developers` — it lives on
    // `employee_profiles`, keyed by user_id (which for a developer holds
    // developers.id; see profByKey in src/utils/employeesData.js). Asking
    // `developers` for it made PostgREST reject the whole select, which set
    // developersError, which returned a 500 — so this endpoint failed
    // outright for EVERY project that had even one team member. The page
    // showed "Failed to load project" and the cause never appeared in it.
    const people = new Map();
    const designationById = new Map();
    if (memberIds.length) {
      const [{ data: developerRows, error: developersError }, { data: profileRows }] =
        await Promise.all([
          svc
            .from("developers")
            .select("id, name")
            .eq("organization_id", auth.orgId)
            .in("id", memberIds),
          svc
            .from("employee_profiles")
            .select("user_id, designation")
            .eq("organization_id", auth.orgId)
            .eq("user_type", "developer")
            .in("user_id", memberIds),
        ]);

      if (developersError) {
        console.error("[client/projects/:id] Team error:", developersError);
        return NextResponse.json(
          { success: false, error: "Failed to load project" },
          { status: 500 }
        );
      }

      for (const d of developerRows || []) people.set(d.id, d);
      // Missing profiles are ordinary, not an error: role simply stays null.
      for (const p of profileRows || []) {
        if (p?.user_id) designationById.set(p.user_id, p.designation || null);
      }
    }

    // Order the team the way memberIds was built (task assignees, then lead) so
    // the list is stable between requests.
    const team = memberIds
      .filter((id) => people.has(id))
      .map((id) => ({
        id,
        name: people.get(id).name || null,
        role: designationById.get(id) || null,
      }));

    // ClientTask: a name for the assignee, never an email; labels default to [].
    const tasks = (taskRows || []).map((t) => ({
      id: t.id,
      title: t.task_title,
      status: t.status,
      priority: t.priority || null,
      due_date: t.due_date || t.end_date || null,
      assignee_name: people.get(t.developer_id)?.name || null,
      labels: Array.isArray(t.labels) ? t.labels : [],
      attachment_count: attachmentCounts.get(t.id) || 0,
    }));

    const { data: updates, error: updatesError } = await svc
      .from("project_updates")
      .select("id, title, body, author_name, created_at")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .eq("client_visible", true)
      .order("created_at", { ascending: false });

    if (updatesError) {
      console.error("[client/projects/:id] Updates error:", updatesError);
      return NextResponse.json(
        { success: false, error: "Failed to load project" },
        { status: 500 }
      );
    }

    const { data: subRows, error: subsError } = await svc
      .from("task_submissions")
      .select("id, file_name, file_type, file_size, submitted_at")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .order("submitted_at", { ascending: false });

    if (subsError) {
      console.error("[client/projects/:id] Deliverables error:", subsError);
      return NextResponse.json(
        { success: false, error: "Failed to load project" },
        { status: 500 }
      );
    }

    // Deliverable metadata only. No storage path, no developer id, no internal
    // review notes, and no task title (the task may well be an internal one).
    const deliverables = (subRows || []).map((s) => ({
      id: s.id,
      file_name: s.file_name,
      file_type: s.file_type,
      file_size: s.file_size,
      submitted_at: s.submitted_at,
    }));

    const { count: pendingApprovals, error: approvalsError } = await svc
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .eq("status", "pending");

    if (approvalsError) {
      console.error("[client/projects/:id] Approvals error:", approvalsError);
      return NextResponse.json(
        { success: false, error: "Failed to load project" },
        { status: 500 }
      );
    }

    // ClientProjectDetail = ClientProjectSummary + the detail fields. The
    // summary half is computed by the same helper the list route uses, so the
    // two views of one project can never disagree.
    const summary = buildProjectSummary({
      project,
      tasks: taskRows || [],
      pendingApprovals: pendingApprovals || 0,
    });

    return NextResponse.json({
      success: true,
      project: {
        ...summary,
        description: project.description || null,
        start_date: project.start_date || null,
        end_date: project.end_date || null,
        milestones,
        tasks,
        team,
        updates: updates || [],
        deliverables,
      },
    });
  } catch (err) {
    console.error("[client/projects/:id] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
