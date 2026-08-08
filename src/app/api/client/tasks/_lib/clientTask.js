// Shared plumbing for the client task routes.
//
// docs/client-portal-v2-contract.md is the contract; both /api/client/tasks/[id]
// and /api/client/tasks/[id]/comments have to answer the same question first —
// "is this caller allowed to know this task exists?" — and they must answer it
// identically. One implementation here means the detail route and the comment
// thread can never drift into disagreeing about who may see what.

import { NextResponse } from "next/server";
import { clientCanAccessProject } from "@/utils/serverAuth";

// Every column either route needs. `client_visible` and `project_id` are read
// for the access decision, not for the response.
export const CLIENT_TASK_FIELDS =
  "id, project_id, client_visible, task_title, task_description, status, priority, labels, due_date, end_date, developer_id, updated_at, client_approval_status, client_approval_note, client_approval_at";

// The single answer to "may this client touch this task?".
//
// Three conditions, and a single outcome for all of them: the task exists in
// the caller's org, it is client_visible, and it sits in a project on the
// caller's allow-list. Anything else returns null and the caller answers 404.
export async function resolveClientTask(svc, auth, taskId) {
  if (!taskId) return null;

  const { data: task, error } = await svc
    .from("developer_tasks")
    .select(CLIENT_TASK_FIELDS)
    .eq("organization_id", auth.orgId)
    .eq("id", taskId)
    .maybeSingle();

  if (error) {
    console.error("[client/tasks] Task lookup error:", error);
    return null;
  }
  if (!task) return null;

  // An internal task is not "forbidden", it is invisible — see taskNotFound.
  if (task.client_visible !== true) return null;
  if (!clientCanAccessProject(auth, task.project_id)) return null;

  return task;
}

// 404, never 403.
//
// A 403 is an answer: it tells the caller that the id they guessed names a real
// task, and that there is something there worth hiding. Iterating ids against a
// route that distinguishes the two cases maps out an organisation's private
// backlog — how much work exists, and when it was created — without ever
// reading a single title. A client that is not allowed to see a task is told
// the same thing as a client that asked for an id nobody ever issued.
export function taskNotFound() {
  return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
}

// ClientComment, from a task_comments row.
//
// `task_comments` (016) has no attachment columns — attachments hang off the
// task itself, not off individual comments — so the two attachment fields are
// always null here. They are still emitted, because a ClientComment is one
// shape everywhere: the thread component is shared-shaped with the project
// thread and must not need to know which route filled it.
export function toClientComment(row) {
  return {
    id: row.id,
    body: row.body,
    author_name: row.author_name || "Unknown",
    author_type: row.author_type === "client" ? "client" : "staff",
    attachment_name: null,
    attachment_url: null,
    created_at: row.created_at,
  };
}

// "changes_requested" -> "Changes Requested". Activity titles are read by a
// person, and the raw column values are snake_case machine words. The client
// components have their own humanize(), but it lives in a "use client" module
// that a route may not import, so the server keeps its own three lines.
export function humanizeValue(value) {
  if (!value) return "";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
