import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";
import {
  resolveClientTask,
  taskNotFound,
  toClientComment,
} from "@/app/api/client/tasks/_lib/clientTask";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_BODY_LENGTH = 5000;

const COMMENT_FIELDS = "id, body, author_name, author_type, created_at";

// GET /api/client/tasks/[id]/comments?limit=&before=
// The conversation on one task, newest first, keyset-paged on `before`.
//
// Staff and client share a single thread (migration 033): the same table
// carries both audiences, separated by `internal`. The filter below is the
// route's half of that — the database enforces the other half, so a bug here
// cannot publish an internal note.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const svc = serviceClient();

    // Access is decided before anything is read, and a refusal is a 404: the
    // comment count on a task is itself information about a task the caller is
    // not supposed to know exists.
    const task = await resolveClientTask(svc, auth, params?.id);
    if (!task) return taskNotFound();

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

    // One extra row answers hasMore without a second count query.
    let query = svc
      .from("task_comments")
      .select(COMMENT_FIELDS)
      .eq("organization_id", auth.orgId)
      .eq("task_id", task.id)
      .eq("internal", false)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (before) query = query.lt("created_at", before);

    const { data: rows, error } = await query;

    if (error) {
      console.error("[client/tasks/:id/comments] Query error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to load comments" },
        { status: 500 }
      );
    }

    const page = (rows || []).slice(0, limit);

    return NextResponse.json({
      success: true,
      comments: page.map(toClientComment),
      hasMore: (rows || []).length > limit,
    });
  } catch (err) {
    console.error("[client/tasks/:id/comments] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/client/tasks/[id]/comments
// Body: { body: string }
//
// The only thing taken from the request is the message text. `internal`,
// `author_type`, `author_id` and the display name all come from the verified
// session, so a client cannot post as staff, post as another client, or post an
// internal note by asking for one — whatever the body claims.
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const svc = serviceClient();

    const task = await resolveClientTask(svc, auth, params?.id);
    if (!task) return taskNotFound();

    let payload;
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }

    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    if (!body) {
      return NextResponse.json(
        { success: false, error: "Comment body is required" },
        { status: 400 }
      );
    }
    if (body.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Comment must be ${MAX_BODY_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }

    // The display name comes from the client's own row, not from the request.
    const { data: client } = await svc
      .from("clients")
      .select("id, name")
      .eq("organization_id", auth.orgId)
      .eq("id", auth.clientId)
      .maybeSingle();

    const { data: inserted, error: insertError } = await svc
      .from("task_comments")
      .insert({
        organization_id: auth.orgId,
        task_id: task.id,
        author_id: auth.clientId,
        author_type: "client",
        author_name: client?.name || "Client",
        body,
        internal: false,
      })
      .select(COMMENT_FIELDS)
      .single();

    if (insertError || !inserted) {
      console.error("[client/tasks/:id/comments] Insert error:", insertError);
      return NextResponse.json(
        { success: false, error: "Failed to post comment" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      comment: toClientComment(inserted),
    });
  } catch (err) {
    console.error("[client/tasks/:id/comments] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
