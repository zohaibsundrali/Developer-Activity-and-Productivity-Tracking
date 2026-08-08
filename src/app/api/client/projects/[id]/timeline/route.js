import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// GET /api/client/projects/[id]/timeline?limit=&before=
// One merged, newest-first feed of everything that happened on a project the
// client is linked to: updates, milestones, approval events, non-internal
// comments and status changes on client-visible tasks.
//
// Paging is keyset, not offset: `before` is the created_at of the last event
// the caller already has. Each source is queried with the same cursor, the five
// results are merged and re-sorted, and the page is cut from the merge — an
// offset would skip events whenever a new one lands mid-scroll.
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

    const { searchParams } = new URL(request.url);

    const requestedLimit = Number(searchParams.get("limit"));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.trunc(requestedLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const before = searchParams.get("before");
    if (before && Number.isNaN(Date.parse(before))) {
      return NextResponse.json(
        { success: false, error: "Invalid 'before' cursor" },
        { status: 400 }
      );
    }

    // One extra row per source tells us whether a further page exists without
    // a second count query.
    const fetchLimit = limit + 1;
    const svc = serviceClient();

    // Apply the shared cursor to whichever column that source is ordered by.
    const applyCursor = (query, column) => (before ? query.lt(column, before) : query);

    const { data: updates, error: updatesError } = await applyCursor(
      svc
        .from("project_updates")
        .select("id, title, body, author_name, created_at")
        .eq("organization_id", auth.orgId)
        .eq("project_id", projectId)
        .eq("client_visible", true)
        .order("created_at", { ascending: false })
        .limit(fetchLimit),
      "created_at"
    );

    if (updatesError) {
      console.error("[client/projects/:id/timeline] Updates error:", updatesError);
      return NextResponse.json(
        { success: false, error: "Failed to load timeline" },
        { status: 500 }
      );
    }

    const { data: milestones, error: milestonesError } = await applyCursor(
      svc
        .from("milestones")
        .select("id, title, description, status, created_at")
        .eq("organization_id", auth.orgId)
        .eq("project_id", projectId)
        .eq("client_visible", true)
        .order("created_at", { ascending: false })
        .limit(fetchLimit),
      "created_at"
    );

    if (milestonesError) {
      console.error("[client/projects/:id/timeline] Milestones error:", milestonesError);
      return NextResponse.json(
        { success: false, error: "Failed to load timeline" },
        { status: 500 }
      );
    }

    const { data: approvalEvents, error: approvalEventsError } = await applyCursor(
      svc
        .from("approval_events")
        .select("id, action, note, actor_name, created_at, approvals(title)")
        .eq("organization_id", auth.orgId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(fetchLimit),
      "created_at"
    );

    if (approvalEventsError) {
      console.error("[client/projects/:id/timeline] Approval events error:", approvalEventsError);
      return NextResponse.json(
        { success: false, error: "Failed to load timeline" },
        { status: 500 }
      );
    }

    const { data: comments, error: commentsError } = await applyCursor(
      svc
        .from("project_comments")
        .select("id, body, author_name, created_at")
        .eq("organization_id", auth.orgId)
        .eq("project_id", projectId)
        .eq("internal", false)
        .order("created_at", { ascending: false })
        .limit(fetchLimit),
      "created_at"
    );

    if (commentsError) {
      console.error("[client/projects/:id/timeline] Comments error:", commentsError);
      return NextResponse.json(
        { success: false, error: "Failed to load timeline" },
        { status: 500 }
      );
    }

    // Task status changes: client-visible tasks only, so an internal task title
    // cannot reach the client through the timeline either. updated_at is when
    // the status last moved, so it is both the sort key and the cursor column.
    const { data: taskStatuses, error: taskStatusesError } = await applyCursor(
      svc
        .from("developer_tasks")
        .select("id, task_title, status, updated_at")
        .eq("organization_id", auth.orgId)
        .eq("project_id", projectId)
        .eq("client_visible", true)
        .order("updated_at", { ascending: false })
        .limit(fetchLimit),
      "updated_at"
    );

    if (taskStatusesError) {
      console.error("[client/projects/:id/timeline] Task status error:", taskStatusesError);
      return NextResponse.json(
        { success: false, error: "Failed to load timeline" },
        { status: 500 }
      );
    }

    const events = [
      ...(updates || []).map((u) => ({
        id: `update:${u.id}`,
        kind: "update",
        title: u.title,
        body: u.body || null,
        actor_name: u.author_name || null,
        created_at: u.created_at,
      })),
      ...(milestones || []).map((m) => ({
        id: `milestone:${m.id}`,
        kind: "milestone",
        title: m.title,
        body: m.description || null,
        actor_name: null,
        created_at: m.created_at,
      })),
      ...(approvalEvents || []).map((e) => ({
        id: `approval:${e.id}`,
        kind: "approval",
        title: e.approvals?.title || "Approval",
        body: e.note || null,
        actor_name: e.actor_name || null,
        created_at: e.created_at,
      })),
      ...(comments || []).map((c) => ({
        id: `comment:${c.id}`,
        kind: "comment",
        title: "Comment",
        body: c.body || null,
        actor_name: c.author_name || null,
        created_at: c.created_at,
      })),
      // The person who moved a task is internal information; the client is told
      // what moved, not who moved it.
      ...(taskStatuses || []).map((t) => ({
        id: `task_status:${t.id}`,
        kind: "task_status",
        title: t.task_title,
        body: t.status || null,
        actor_name: null,
        created_at: t.updated_at,
      })),
    ];

    events.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

    return NextResponse.json({
      success: true,
      events: events.slice(0, limit),
      hasMore: events.length > limit,
    });
  } catch (err) {
    console.error("[client/projects/:id/timeline] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
