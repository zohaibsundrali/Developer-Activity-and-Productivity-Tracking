import { NextResponse } from "next/server";
import { getAuthedClient, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// Load a thread and confirm it belongs to the authed client. Returns the row
// or null.
async function loadOwnedThread(svc, auth, threadId) {
  const { data, error } = await svc
    .from("support_threads")
    .select("id, project_id, client_id, subject, status, last_message_at, created_at")
    .eq("organization_id", auth.orgId)
    .eq("id", threadId)
    .single();
  if (error || !data) return null;
  if (data.client_id !== auth.clientId) return "forbidden";
  return data;
}

// GET /api/client/support/[threadId]
// Full thread with its messages, oldest first.
export async function GET(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const threadId = params?.threadId;
    if (!threadId) {
      return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
    }

    const svc = serviceClient();
    const thread = await loadOwnedThread(svc, auth, threadId);
    if (!thread) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (thread === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: messages, error } = await svc
      .from("support_messages")
      .select("id, thread_id, sender_type, sender_id, sender_name, body, created_at")
      .eq("organization_id", auth.orgId)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[client/support/:threadId] Messages error:", error);
      return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
    }

    return NextResponse.json({ thread, messages: messages || [] });
  } catch (err) {
    console.error("[client/support/:threadId] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/client/support/[threadId]
// Post a reply from the client and bump the thread's last_message_at.
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const threadId = params?.threadId;
    if (!threadId) {
      return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    if (!body) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const svc = serviceClient();
    const thread = await loadOwnedThread(svc, auth, threadId);
    if (!thread) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (thread === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date().toISOString();

    const { data: message, error: messageError } = await svc
      .from("support_messages")
      .insert({
        organization_id: auth.orgId,
        thread_id: threadId,
        sender_type: "client",
        sender_id: auth.clientId,
        sender_name: auth.email,
        body,
      })
      .select("id, thread_id, sender_type, sender_id, sender_name, body, created_at")
      .single();

    if (messageError || !message) {
      console.error("[client/support/:threadId] Insert error:", messageError);
      return NextResponse.json({ error: "Failed to post message" }, { status: 500 });
    }

    const { error: bumpError } = await svc
      .from("support_threads")
      .update({ last_message_at: now })
      .eq("id", threadId)
      .eq("organization_id", auth.orgId);

    if (bumpError) {
      console.error("[client/support/:threadId] Bump error:", bumpError);
    }

    return NextResponse.json({ message });
  } catch (err) {
    console.error("[client/support/:threadId] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
