import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/client/support
// The client's own support threads, most recently active first.
export async function GET(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = serviceClient();
    const { data, error } = await svc
      .from("support_threads")
      .select("id, project_id, client_id, subject, status, last_message_at, created_at")
      .eq("organization_id", auth.orgId)
      .eq("client_id", auth.clientId)
      .order("last_message_at", { ascending: false });

    if (error) {
      console.error("[client/support] Query error:", error);
      return NextResponse.json({ error: "Failed to load threads" }, { status: 500 });
    }

    return NextResponse.json({ threads: data || [] });
  } catch (err) {
    console.error("[client/support] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/client/support
// Open a new support thread with its first message.
export async function POST(request) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }
    const subject = typeof payload?.subject === "string" ? payload.subject.trim() : "";
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    const projectId = payload?.projectId || null;

    if (!subject) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }
    if (!body) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    // A supplied project must be one the client is linked to.
    if (projectId && !clientCanAccessProject(auth, projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const svc = serviceClient();
    const now = new Date().toISOString();

    const { data: thread, error: threadError } = await svc
      .from("support_threads")
      .insert({
        organization_id: auth.orgId,
        project_id: projectId,
        client_id: auth.clientId,
        subject,
        last_message_at: now,
      })
      .select("id, project_id, client_id, subject, status, last_message_at, created_at")
      .single();

    if (threadError || !thread) {
      console.error("[client/support] Thread insert error:", threadError);
      return NextResponse.json({ error: "Failed to create thread" }, { status: 500 });
    }

    const { error: messageError } = await svc.from("support_messages").insert({
      organization_id: auth.orgId,
      thread_id: thread.id,
      sender_type: "client",
      sender_id: auth.clientId,
      sender_name: auth.email,
      body,
    });

    if (messageError) {
      console.error("[client/support] Message insert error:", messageError);
      return NextResponse.json({ error: "Failed to create thread" }, { status: 500 });
    }

    return NextResponse.json({ thread });
  } catch (err) {
    console.error("[client/support] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
