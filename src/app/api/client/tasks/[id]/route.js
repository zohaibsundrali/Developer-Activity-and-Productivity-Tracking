import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";
import {
  resolveClientTask,
  taskNotFound,
  humanizeValue,
} from "@/app/api/client/tasks/_lib/clientTask";

export const dynamic = "force-dynamic";

// Task attachments live in the PRIVATE `task-submissions` bucket under the
// pm/{organization_id}/{task_id}/ layout that uploadTaskAttachment writes. The
// stored path never leaves the server: it is exchanged for a short-lived signed
// URL on every response, so a link that leaks is a link that has already died.
const BUCKET = "task-submissions";
const SIGNED_URL_TTL = 10 * 60;

// Only a path inside THIS org's folder is ever signed. Without the check, a row
// with a doctored path — another tenant's folder, or a traversal out of it —
// would be handed back as a working download link.
function orgAttachmentPath(value, orgId) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.includes("..")) return null;
  return path.startsWith(`pm/${orgId}/`) ? path : null;
}

// Mint signed URLs for a batch of attachment rows. Returns a Map of
// path -> signed URL; anything unsignable simply stays absent and the
// attachment is returned with a null url rather than failing the whole task.
async function signAttachments(svc, rows, orgId) {
  const paths = [];
  for (const row of rows) {
    const path = orgAttachmentPath(row.file_path, orgId);
    if (path && !paths.includes(path)) paths.push(path);
  }
  const signed = new Map();
  if (!paths.length) return signed;

  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  if (error) {
    console.error("[client/tasks/:id] Sign error:", error);
    return signed;
  }

  for (const entry of data || []) {
    if (entry?.path && entry?.signedUrl) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

// GET /api/client/tasks/[id]
// One client-visible task on a project the caller is linked to.
//
// A task the caller may not see answers 404, not 403 — see taskNotFound. The
// same rule covers "no such task", "internal task" and "someone else's task",
// because telling them apart is exactly what a probe is looking for.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const svc = serviceClient();
    const task = await resolveClientTask(svc, auth, params?.id);
    if (!task) return taskNotFound();

    // The assignee is a NAME. The select never asks for an email and never
    // touches employee_profiles: who is on the work is client business, how to
    // reach them privately is not.
    let assigneeName = null;
    if (task.developer_id) {
      const { data: developer } = await svc
        .from("developers")
        .select("id, name")
        .eq("organization_id", auth.orgId)
        .eq("id", task.developer_id)
        .maybeSingle();
      assigneeName = developer?.name || null;
    }

    const { data: attachmentRows, error: attachmentsError } = await svc
      .from("task_attachments")
      .select("id, file_name, file_path, file_type, file_size, created_at")
      .eq("organization_id", auth.orgId)
      .eq("task_id", task.id)
      .order("created_at", { ascending: false });

    if (attachmentsError) {
      console.error("[client/tasks/:id] Attachments error:", attachmentsError);
      return NextResponse.json(
        { success: false, error: "Failed to load task" },
        { status: 500 }
      );
    }

    const signedUrls = await signAttachments(svc, attachmentRows || [], auth.orgId);

    // File metadata plus a link. `file_path` and `uploaded_by` are dropped: the
    // client gets the file, not its location or the person who put it there.
    const attachments = (attachmentRows || []).map((a) => {
      const path = orgAttachmentPath(a.file_path, auth.orgId);
      return {
        id: a.id,
        file_name: a.file_name,
        file_type: a.file_type,
        file_size: a.file_size,
        url: (path && signedUrls.get(path)) || null,
      };
    });

    // Approvals raised against this task, and their decision trail. `item_ref`
    // is the id of whatever the approval is about (014), so a task-linked
    // approval is found by matching it — inside the project we have already
    // proved the caller may read.
    const { data: approvals, error: approvalsError } = await svc
      .from("approvals")
      .select("id, title")
      .eq("organization_id", auth.orgId)
      .eq("project_id", task.project_id)
      .eq("item_ref", task.id);

    if (approvalsError) {
      console.error("[client/tasks/:id] Approvals error:", approvalsError);
      return NextResponse.json(
        { success: false, error: "Failed to load task" },
        { status: 500 }
      );
    }

    const approvalTitles = new Map((approvals || []).map((a) => [a.id, a.title]));
    let approvalEvents = [];
    if (approvalTitles.size) {
      const { data: eventRows, error: eventsError } = await svc
        .from("approval_events")
        .select("id, approval_id, action, actor_name, created_at")
        .eq("organization_id", auth.orgId)
        .in("approval_id", [...approvalTitles.keys()])
        .order("created_at", { ascending: false });

      if (eventsError) {
        console.error("[client/tasks/:id] Approval events error:", eventsError);
        return NextResponse.json(
          { success: false, error: "Failed to load task" },
          { status: 500 }
        );
      }
      approvalEvents = eventRows || [];
    }

    // The task's own history: what happened to this piece of work, and nothing
    // about how the team works. pm_activity is deliberately NOT a source — it
    // carries timer starts and stops, automation runs and internal field edits,
    // which is the productivity data the contract forbids sending a client.
    const activity = [];

    // developer_tasks is stamped on update, so updated_at is when the status
    // last moved. The project timeline reads it the same way, so one status
    // change cannot be dated differently on the two screens.
    if (task.status && task.updated_at) {
      activity.push({
        id: `task_status:${task.id}`,
        kind: "task_status",
        title: `Status: ${humanizeValue(task.status)}`,
        // Who moved a task is internal information; the client is told what
        // moved, not who moved it.
        actor_name: null,
        created_at: task.updated_at,
      });
    }

    if (task.client_approval_status && task.client_approval_at) {
      activity.push({
        id: `client_approval:${task.id}`,
        kind: "approval",
        title: `Client approval: ${humanizeValue(task.client_approval_status)}`,
        actor_name: null,
        created_at: task.client_approval_at,
      });
    }

    for (const event of approvalEvents) {
      activity.push({
        id: `approval:${event.id}`,
        kind: "approval",
        title: `${humanizeValue(event.action)}: ${approvalTitles.get(event.approval_id) || "Approval"}`,
        actor_name: event.actor_name || null,
        created_at: event.created_at,
      });
    }

    activity.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        title: task.task_title,
        description: task.task_description || null,
        status: task.status,
        priority: task.priority || null,
        // The project's task list reads due_date with end_date as its fallback.
        // The same fallback here keeps the detail from showing a different due
        // date to the row the client clicked to get to it.
        due_date: task.due_date || task.end_date || null,
        assignee_name: assigneeName,
        labels: Array.isArray(task.labels) ? task.labels : [],
        client_approval_status: task.client_approval_status || null,
        client_approval_note: task.client_approval_note || null,
        attachments,
        activity,
      },
    });
  } catch (err) {
    console.error("[client/tasks/:id] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
